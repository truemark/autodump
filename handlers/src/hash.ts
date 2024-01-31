import {SecretsManagerClient, DescribeSecretCommand} from "@aws-sdk/client-secrets-manager";
import {AutoDumpTags} from "./hash-helper";

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

// const currentRegion = process.env.AWS_REGION;
export async function handler(event: any): Promise<any> {
  const secretArn = event.secretArn;
  const hash = event.hash;

  const currentRegion = process.env.AWS_REGION;

  const client = new SecretsManagerClient({region: currentRegion});
  const input = { // DescribeSecretRequest
    SecretId: secretArn
  };
  const command = new DescribeSecretCommand(input);
  const response = await client.send(command);
  console.log(`response is ${JSON.stringify(response)}`)

  // Do logic
  // get secret
  // get tags on secret
  // calculate tags on secret
  // compare hashes and decide to continue or not

  // This is your raw output for your step in your step function
  return {
    hash,
    secretArn,
    execute: false, // This is what you use in your choice to bail out
    reason: 'Some reason', // This is your reason for bailing that helps you when debugging
    // whatever else you need to pass to the next step
  }
}
