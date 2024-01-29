import {SecretsManagerClient, Tag as Tags} from "@aws-sdk/client-secrets-manager";
import * as cron from "cron-parser";
import {CronExpression} from "cron-parser/types";
import {ISecret, Secret} from "aws-cdk-lib/aws-secretsmanager";
import {Construct} from "constructs";

interface AutoDumpTags {
  readonly timezone?: string;
  readonly startSchedule?: string;
}

enum AutoDumpTag {
  START_SCHEDULE = "autodump:start-schedule",
  TIMEZONE = "autodump:timezone",
}

const currentRegion = process.env.AWS_REGION;
const client = new SecretsManagerClient({region: currentRegion});

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

export interface SecretHelperProps  {
  readonly secretHelp: string;
}

class SecretHelper extends Construct {
  private secretHelp?: ISecret;

  constructor(scope: Construct, id: string, props: SecretHelperProps) {
    super(scope, id);

    // Do any additional setup here
  }

  getSecret = (secretArn: string): ISecret => {
    if (!this.secretHelp) {
      this.secretHelp = Secret.fromSecretArn(this, 'MySecret', secretArn, {
        // optional configuration
      });
    }

    return <ISecret>this.secretHelp;
  }
}

export async function handler(event: any): Promise<any> {

  try {

    const secretArn = event.SecretArn;
    console.log(`secret arn is ${secretArn}, calling SecretHelper`);
    const helper: SecretHelper = new SecretHelper(this, 'mysecret', {secretHelp: secretArn});
    const secret = SecretHelper.getSecret();
    console.log(`secret is ${secret.ARN}`)
    const tags = getTags(secret.Tags);
    console.log(`tags are ${tags}`);
    const tagsHash = hashTagsV1(tags);
    console.log(`tags hash is ${tagsHash}`);
    return tagsHash

  } catch (error) {
    console.error("Error fetching secret hash:", error);
    return {
      statusCode: 400,
      body: JSON.stringify({
        message: `Error fetching secret hash: ${error}`,
      }),
    }
  }
}
