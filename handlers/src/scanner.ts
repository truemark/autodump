import {
  GetSecretValueCommand,
  GetSecretValueCommandOutput,
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

function nextAction(resource: AutoDumpResource): AutoDumpAction | undefined {
  let selected = undefined;
  const actions = [...cronActions(resource)];
  for (const action of actions) {
    console.log(`nextAction: action.when is ${action.when}`);
    if (selected === undefined || action.when < selected.when) {
      selected = action;
    }
  }
  console.log(`nextAction: selected is JSON.stringify(${selected})`);
  return selected;
}

interface EventParameters {
  readonly input: string;
  readonly stateMachineArn: string;
}

// This is the format of the secret. If these properties do not exist, everything will fail.
interface SecretString {
  readonly password: string;
  readonly username: string;
  readonly endpoint: string;
  readonly engine: string;
  readonly bucketname: string;
  readonly databasename: string;
}
async function getDatabaseName(secretName: string): Promise<string> {
  try {
    // Create the command
    const command = new GetSecretValueCommand({
      SecretId: secretName,
    });

    // Send the request and get the response
    const response: GetSecretValueCommandOutput = await client.send(command);
    // response.SecretString
    const secretObject: SecretString = response.SecretString
      ? JSON.parse(response.SecretString)
      : {};

    return secretObject.databasename;
  } catch (error) {
    console.error('Error fetching database name from secret. Exiting. ', error);
    throw error;
  }
}

function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);

  const year = date.getFullYear();
  const month = date.getMonth() + 1; // getMonth() returns 0-11
  const day = date.getDate();
  const hours = date.getHours();
  const minutes = date.getMinutes();

  // Pad single digit month, day, hours, and minutes with leading zeros
  const formattedMonth = month < 10 ? `0${month}` : month;
  const formattedDay = day < 10 ? `0${day}` : day;
  const formattedHours = hours < 10 ? `0${hours}` : hours;
  const formattedMinutes = minutes < 10 ? `0${minutes}` : minutes;

  return `${year}-${formattedMonth}-${formattedDay}-${formattedHours}-${formattedMinutes}`;
}

export async function handler(event: EventParameters): Promise<boolean> {
  console.log(`handler: event is ${JSON.stringify(event)}`);
  // Parsing the 'input' field to get the State Machine ARN
  const input = event.input;
  const parsedInput: EventParameters = JSON.parse(input);
  let stateMachineArn = '';
  if (parsedInput.stateMachineArn === undefined) {
    console.log(
      `stateMachineArn undefined. Exiting. input is ${JSON.stringify(event)}`
    );
    return false;
  } else {
    // Use the State Machine ARN
    stateMachineArn = parsedInput.stateMachineArn;
    console.log(`handler: stateMachineARN is:, ${stateMachineArn}`);

    // 100 is the maximum value for MaxResults.
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

                  const executionTime = formatTimestamp(nextTime.when);
                  console.log(
                    `nextTime: executionTime as a formatted string is ${executionTime}`
                  );
                  const databaseName: string = await getDatabaseName(
                    secret.ARN
                  );

                  let jobName = '';
                  if (secret.Name !== undefined && databaseName !== undefined) {
                    jobName = `${secret.Name.slice(
                      0,
                      60
                    )}-${databaseName}-${executionTime}`.slice(0, 80);
                  }

                  console.log(
                    `starting state machine execution: nextTime is ${nextTime.when}  ${stateMachineArn} ${action[0].resourceId}`
                  );

                  try {
                    const startStateMachineResponse = await sfnClient.send(
                      new StartExecutionCommand({
                        stateMachineArn: stateMachineArn,
                        input: JSON.stringify(action[0]),
                        name: jobName,
                      })
                    );
                    console.log(
                      `start state machine response is ${startStateMachineResponse.executionArn}, ${startStateMachineResponse.startDate}, ${startStateMachineResponse.$metadata.httpStatusCode}`
                    );
                  } catch (error) {
                    console.log(
                      `Job name ${jobName} is a duplicate. Exiting gracefully.`
                    );
                  }
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
      return false;
    }
  }
}
