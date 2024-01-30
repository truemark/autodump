import {SecretsManagerClient, ListSecretsCommand, Tag as Tags} from "@aws-sdk/client-secrets-manager";
import * as cron from "cron-parser";
import {CronExpression} from "cron-parser/types"
import {SFNClient, StartExecutionCommand} from "@aws-sdk/client-sfn"
import {error} from "aws-cdk/lib/logging";
import * as arnparser from "@aws-sdk/util-arn-parser"


interface AutoDumpTags {
  readonly timezone?: string;
  readonly startSchedule?: string;
}

interface AutoDumpAction {
  readonly resourceId: string;
  readonly tagsHash: string;
  readonly when: string;
}

interface AutoDumpActionResult extends AutoDumpAction {
  readonly execute: boolean,
  readonly reason: string,
  readonly resource?: AutoDumpResource
}

interface AutoDumpResource {
  readonly id: string;
  readonly tags: AutoDumpTags;
  readonly tagsHash: string;
}

enum AutoDumpTag {
  START_SCHEDULE = "autodump:start-schedule",
  TIMEZONE = "autodump:timezone",
}

const client = new SecretsManagerClient({region: "us-west-2"});
const sfnClient = new SFNClient({});

export function cyrb53(str: string, seed: number = 0): number {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0, ch; i < str.length; i++) {
    ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);

  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

function hashTagsV1(tags: AutoDumpTags): string {
  return "V1" + cyrb53(`${tags.timezone ?? ""}|${tags.startSchedule ?? ""}`);
}

function optionalCron(value: string | undefined, tz: string): CronExpression | undefined {
  if (value) {
    const parts = value.split(/\s+/);
    if (parts.length !== 5) {
      throw new Error(`Invalid cron expression: ${value}. Expecting 5 fields and received ${parts.length}}`);
    }
    if (parts[0].trim() === "*" || parts[0].trim() === "-") {
      throw new Error("Invalid cron expression. The use * or - in the minute field is not allowed.");
    }
    const cleaned = value.trim().replaceAll(" -", " *").replaceAll(":", ",");
    return cron.parseExpression(cleaned, {
      tz,
      currentDate: new Date(Date.now() + 60000), // look 1 minute in the future to be safe
    })
  }
  return undefined;
}

function cronAction(resource: AutoDumpResource, cronExpression: string): AutoDumpAction | undefined {
  const tz = resource.tags.timezone ?? "UTC";
  const expression = optionalCron(cronExpression, tz);
  if (expression && expression.hasNext()) {
    return {
      resourceId: resource.id,
      tagsHash: hashTagsV1(resource.tags),
      when: expression.next().toISOString(),
    };
  } else {
    return undefined;
  }
}

function cronActions(resource: AutoDumpResource): AutoDumpAction[] {
  const actions: AutoDumpAction[] = [];
  if (resource.tags.startSchedule !== undefined) {
    const start = cronAction(resource, resource.tags.startSchedule);

    if (start) {
      console.log(`cronActions: dump database from ${start.resourceId} at ${start.when}`);
      actions.push(start);
    }
  }
  return actions;
}

function nextAction(resource: AutoDumpResource, priorAction?: AutoDumpAction): AutoDumpAction | undefined {
  let selected = undefined;
  const actions = [...cronActions(resource)];
  for (const action of actions) {
    if (selected === undefined || action.when < selected.when) {
      selected = action;
    }
  }
  return selected;
}

function toCamelCase(str: string): string {
  str = (str.match(/[a-zA-Z0-9]+/g) || []).map(x => `${x.charAt(0).toUpperCase()}${x.slice(1)}`).join("");
  return str.charAt(0).toLowerCase() + str.slice(1);
}

function getTags(tags?: Tags[]): AutoDumpTags {
  if (!tags) {
    return {};
  }

  const autoDumpTags = tags.reduce((tags, tag) => {
    const autoDumpTags: Record<string, string> = {};
    if (tag.Key && tag.Value && Object.values(AutoDumpTag).includes(tag.Key as AutoDumpTag)) {
      const key = toCamelCase(tag.Key.replace("autodump:", ""));
      autoDumpTags[key] = tag.Value.trim();
    }
    return {
      ...autoDumpTags
    }
  }, {} as AutoDumpTags) ?? {};
  return autoDumpTags;
}

export async function listSecrets(event: any): Promise<any> {

  const stateMachineArn = event.StateMachineArn;
  const secretArn = event.SecretArn;
  console.log(`\n\nhandler: state machine arn is ${stateMachineArn}, secret arn is ${secretArn}\n`);

  const listSecretsRequest = {
    MaxResults: 100,
  };

  const command = await new ListSecretsCommand(listSecretsRequest);
  const listSecretsResponse = await client.send(command);

  try {
    if (listSecretsResponse.SecretList) {
      const resources: AutoDumpResource[] = [];
      const action: AutoDumpAction[] = [];

      for (const secret of listSecretsResponse.SecretList) {
        console.log(`Accessing tags for secret: ${secret.Name}`);

        if (typeof secret.Tags !== 'undefined' && secret.Tags.length > 0) {
          for (const tag of secret.Tags) {
            if (tag.Key === AutoDumpTag.START_SCHEDULE && tag.Value !== null && secret.ARN !== undefined ) {

              // This secret should be scheduled.
              console.log(`Secret eligible for scheduling: ${secret.Name} tag present: ${tag.Key}, schedule is ${tag.Value}`);
              const tags = getTags(secret.Tags);

              resources.push({
                id: secret.ARN.toString(),
                tags,
                tagsHash: hashTagsV1(tags),
              })
              const nextTime = nextAction(resources[0]);

              if (secret.ARN && nextTime !== undefined) {
                action.push({
                  resourceId: secret.ARN.toString(),
                  tagsHash: hashTagsV1(tags),
                  when: nextTime.when,
                });

                const secretName = arnparser.parse(secret.Arn.toString()).resource.split(":")[6]
                console.log(`starting state machine execution: secretName is ${secretName}, nextTime is ${nextTime.when}  ${stateMachineArn} ${action[0].resourceId}`);
                const startStateMachineResponse = await sfnClient.send(new StartExecutionCommand({
                  stateMachineArn: stateMachineArn,
                  input: JSON.stringify(action[0]),
                  // name:
                }));
                console.log('post execution')
              }
            }
          }
        } else {
          console.log(`No tags available for this secret --->>> ${secret.Name}.`);
        }
      }
    }
  } catch (error) {
    console.error("Error listing secrets:", error);
    return {
      statusCode: 400,
      body: JSON.stringify({
        message: `Error listing secrets. ${error}`,
      }),
    }
  }
  return {
    statusCode: 200,
    body: JSON.stringify({
      message: "Successful execution",
    }),
  };
}

export async function fetchHash(secretArn: string): Promise<string> {

}

export async handler
