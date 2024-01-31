// import {SecretsManagerClient, ListSecretsCommand, Tag as Tags} from "@aws-sdk/client-secrets-manager";
// import {Secret, fromSecretCompleteArn } from "@aws-cdk-lib/aws-secretsmanager";
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
  const secretArn = event.Execution.secretArn;
  const hash = event.Execution.hash;

  // // const tagsHash : string;
  // // const secretArn = event.SecretArn;
  // console.log(`\n\nfetch hash handler:  secret arn is ${secretArn}\n`);
  //
  //
  // console.log(`\n\nhandler: secret arn is ${secretArn}\n`);
  // try {
  //   if (secretArn === undefined) {
  //     console.log(`secretArn is undefined, exiting.`);
  //     return {
  //       statusCode: 400,
  //       body: JSON.stringify({
  //         message: `Error fetching current hash for secret. ${error}`,
  //       }),
  //     }
  //   } else {
  //
  //     console.log(`\n\nhandler: secret arn is ${secretArn}\n`);
  //     const tagsHash = await autoDump.getTagsHash(secretArn);
  //     console.log(`\n\nhandler: hash is ${tagsHash}\n`);
  //   }
  // } catch (error) {
  //   console.error(`late error fetching current hash for secret: ${error}`);
  //   return {
  //     statusCode: 400,
  //     body: JSON.stringify({
  //       message: `Error fetching secret hash. ${error}`,
  //     }),
  //   }
  // }


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
