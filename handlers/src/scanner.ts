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
  console.log(
    `cronAction: resource is ${JSON.stringify(
      resource
    )}, cronExpression is ${cronExpression}`
  );
  const tz = resource.tags.timezone ?? 'UTC';
  console.log(`cronAction: timezone is ${tz}`);
  const expression = optionalCron(cronExpression, tz);
  console.log(
    `cronAction: timezone is i${tz}, expression is ${JSON.stringify(
      expression
    )}, resource is ${JSON.stringify(resource)}`
  );
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
  console.log(`nextAction: actions are ${JSON.stringify(actions)}`);
  for (const action of actions) {
    console.log(`nextAction: action.when is ${action.when}`);
    if (selected === undefined || action.when < selected.when) {
      selected = action;
    }
  }
  console.log(`nextAction: selected is ${JSON.stringify(selected)}`);
  return selected;
}

interface EventSourceParameters {
  readonly input: string;
  readonly stateMachineArn: string;
}

// These properties are upper case because of the format of the state machine event.
interface StateMachineEventParameters {
  readonly SecretArn: string;
  readonly Execution: {
    readonly Id: string;
    readonly Input: {
      readonly resourceId: string;
      readonly tagsHash: string;
      readonly when: string;
    };
    readonly StartTime: string;
    readonly Name: string;
    readonly RoleArn: string;
    readonly RedriveCount: number;
  };
  readonly When: string;
  readonly State: {
    readonly Name: string;
    readonly EnteredTime: string;
  };
  readonly StateMachine: {
    readonly Id: string;
    readonly Name: string;
  };
  readonly TagsHash: string;
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

type Event = EventSourceParameters & StateMachineEventParameters;

export async function handler(event: Event): Promise<boolean> {
  console.log(`handler: event is ${JSON.stringify(event)}`);
  let stateMachineArn = undefined;

  // figure out what the source of the event is: scheduled rule or state machine call
  try {
    if (event.StateMachine.Id !== undefined) {
      // from state machine call

      stateMachineArn = event.StateMachine.Id;

      console.log(
        `Firing a reschedule execution. stateMachineArn ${stateMachineArn}`
      );
    }
  } catch (error) {
    console.error('Execution is not from a state machine call.');
  }

  try {
    if (JSON.parse(event.input).stateMachineArn !== undefined) {
      // From Event Bridge rule: Parsing the 'input' field to get the State Machine ARN
      stateMachineArn = JSON.parse(event.input).stateMachineArn;

      console.log(`Event Bridge call: stateMachineArn is ${stateMachineArn}`);
    }
  } catch (error) {
    // catchall error
    console.error('Execution is not from an Event Bridge rule.');
  }

  if (stateMachineArn === undefined) {
    console.error(
      'stateMachineArn is undefined, cannot identify event source. Exiting.'
    );
    return false;
  }

  interface listSecretsCommandParameters {
    NextToken?: string;
  }

  let nextToken;
  const params = {};
  // TODO: add pagination 100 is the maximum value for MaxResults.
  const listSecretsCommandParameters: listSecretsCommandParameters = {};
  if (nextToken) {
    listSecretsCommandParameters.NextToken = nextToken;
  }

  const command = new ListSecretsCommand(listSecretsCommandParameters);
  const listSecretsCommandOutput = await client.send(command);

  try {
    if (listSecretsCommandOutput.SecretList) {
      const resources: AutoDumpResource[] = [];
      const action: AutoDumpAction[] = [];

      for (const secret of listSecretsCommandOutput.SecretList) {
        if (typeof secret.Tags !== 'undefined' && secret.Tags.length > 0) {
          console.log(`secret.Tags is ${JSON.stringify(secret.Tags)}`);
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
              console.log(`tags are ${JSON.stringify(tags)}`);

              resources.push({
                id: secret.ARN.toString(),
                tags,
                tagsHash: hashTagsV1(tags),
              });
              console.log(
                `nextAction: calling with ${JSON.stringify(resources)}`
              );
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
                const databaseName: string = await getDatabaseName(secret.ARN);

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
              resources.length = 0;
              action.length = 0;
            }
          }
        } else {
          console.log(
            `No autodump tags available for this secret --->>> ${secret.Name}.`
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
