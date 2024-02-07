import {
  SecretsManagerClient,
  ListSecretsCommand,
} from '@aws-sdk/client-secrets-manager';
import * as cron from 'cron-parser';
import {CronExpression} from 'cron-parser/types';
import {SFNClient, StartExecutionCommand} from '@aws-sdk/client-sfn';
import {AutoDumpTag, AutoDumpTags, getTags, hashTagsV1} from './hash-helper';

interface AutoDumpAction {
  readonly resourceId: string;
  readonly tagsHash: string;
  readonly when: string;
}

interface AutoDumpResource {
  readonly id: string;
  readonly tags: AutoDumpTags;
  readonly tagsHash: string;
}

const currentRegion = process.env.AWS_REGION;
const client = new SecretsManagerClient({region: currentRegion});
const sfnClient = new SFNClient({});

function optionalCron(
  value: string | undefined,
  tz: string
): CronExpression | undefined {
  if (value) {
    const parts = value.split(/\s+/);
    if (parts.length !== 5) {
      throw new Error(
        `Invalid cron expression: ${value}. Expecting 5 fields and received ${parts.length}}`
      );
    }
    if (parts[0].trim() === '*' || parts[0].trim() === '-') {
      throw new Error(
        'Invalid cron expression. The use * or - in the minute field is not allowed.'
      );
    }
    const cleaned = value.trim().replaceAll(' -', ' *').replaceAll(':', ',');
    return cron.parseExpression(cleaned, {
      tz,
      currentDate: new Date(Date.now() + 60000), // look 1 minute in the future to be safe
    });
  }
  return undefined;
}

function cronAction(
  resource: AutoDumpResource,
  cronExpression: string
): AutoDumpAction | undefined {
  const tz = resource.tags.timezone ?? 'UTC';
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
      console.log(
        `cronActions: dump database from ${start.resourceId} at ${start.when}`
      );
      actions.push(start);
    }
  }
  return actions;
}

function nextAction(
  resource: AutoDumpResource
  // priorAction?: AutoDumpAction
): AutoDumpAction | undefined {
  let selected = undefined;
  const actions = [...cronActions(resource)];
  for (const action of actions) {
    if (selected === undefined || action.when < selected.when) {
      selected = action;
    }
  }
  return selected;
}

interface eventParameters {
  readonly StateMachineArn: string;
}

export async function handler(event: eventParameters): Promise<boolean> {
  const stateMachineArn = event.StateMachineArn;

  if (stateMachineArn !== undefined) {
    console.log(`handler: state machine arn is ${stateMachineArn}`);

    const listSecretsRequest = {
      MaxResults: 100,
    };

    const command = new ListSecretsCommand(listSecretsRequest);
    const listSecretsResponse = await client.send(command);

    console.log(
      `listSecretsResponse.SecretList is ${listSecretsResponse.SecretList}`
    );

    try {
      if (listSecretsResponse.SecretList) {
        const resources: AutoDumpResource[] = [];
        const action: AutoDumpAction[] = [];

        for (const secret of listSecretsResponse.SecretList) {
          console.log(`Accessing tags for secret: ${secret.Name}`);

          if (typeof secret.Tags !== 'undefined' && secret.Tags.length > 0) {
            for (const tag of secret.Tags) {
              if (
                tag.Key === AutoDumpTag.START_SCHEDULE &&
                tag.Value !== null &&
                secret.ARN !== undefined
              ) {
                // This secret should be scheduled.
                console.log(
                  `Secret eligible for scheduling: ${secret.Name} tag present: ${tag.Key}, schedule is ${tag.Value}`
                );
                const tags = getTags(secret.Tags);

                resources.push({
                  id: secret.ARN.toString(),
                  tags,
                  tagsHash: hashTagsV1(tags),
                });
                const nextTime = nextAction(resources[0]);

                if (secret.ARN && nextTime !== undefined) {
                  action.push({
                    resourceId: secret.ARN.toString(),
                    tagsHash: hashTagsV1(tags),
                    when: nextTime.when,
                  });

                  const epoch = Date.now();
                  const jobName = secret.Name + '-' + epoch;

                  console.log(
                    `starting state machine execution: nextTime is ${nextTime.when}  ${stateMachineArn} ${action[0].resourceId}`
                  );

                  const startStateMachineResponse = await sfnClient.send(
                    new StartExecutionCommand({
                      stateMachineArn: stateMachineArn,
                      input: JSON.stringify(action[0]),
                      name: jobName.slice(0, 80),
                    })
                  );
                  console.log(
                    `start state machine response is ${startStateMachineResponse}`
                  );
                }
              }
            }
          } else {
            console.log(
              `No tags available for this secret --->>> ${secret.Name}.`
            );
          }
        }
      }
      return true;
    } catch (error) {
      console.error('Error listing secrets:', error);
      return {
        message: `Error listing secrets. ${error}`,
      };
    }
  } else {
    console.log('handler: no state machine arn provided');
    throw new Error('No state machine arn provided');
    return false;
  }
}
