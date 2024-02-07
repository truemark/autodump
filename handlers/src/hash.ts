import {
  SecretsManagerClient,
  DescribeSecretCommand,
} from '@aws-sdk/client-secrets-manager';
import {getTags, hashTagsV1} from './hash-helper';

const currentRegion = process.env.AWS_REGION;

interface eventParameters {
  readonly SecretArn: string;
  readonly TagsHash: string;
}

interface returnValue {
  readonly hash: string;
  readonly secretArn: string;
  readonly execute: boolean;
  readonly reason: string;
}

export async function handler(event: eventParameters): Promise<returnValue> {
  console.log(`event is ${JSON.stringify(event)}`);
  const secretArn = event.Secret;
  const hash = event.TagsHash;
  console.log(`starting function: secretArn is ${secretArn}, hash is ${hash}`);

  const client = new SecretsManagerClient({region: currentRegion});
  const input = {
    SecretId: secretArn,
  };
  const command = new DescribeSecretCommand(input);
  const response = await client.send(command);
  console.log(`response is ${JSON.stringify(response.Tags)}`);
  const tags = getTags(response.Tags);
  const currentHash = hashTagsV1(tags);
  console.log(`current hash is ${currentHash}`);

  if (currentHash === hash) {
    // return true;
    // {
    return {
      hash,
      secretArn,
      execute: true,
      reason: `Initial and current hashes match: ${hash} . Continue execution.`,
    };
  } else {
    return {
      hash,
      secretArn,
      execute: false,
      reason: `Hashes do not match. Initial Hash: ${hash} , Current Hash: ${currentHash} . This means the schedule tag has changed since this task was initially scheduled.`,
    };
  }
}
