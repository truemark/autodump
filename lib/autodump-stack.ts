import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import {AutoDump} from "./autodump-construct";
import { ExtendedStack, ExtendedStackProps } from "truemark-cdk-lib/aws-cdk";

export class AutoDumpStack extends ExtendedStack {
  constructor(scope: Construct, id: string, props?: ExtendedStackProps) {
    super(scope, id, props);

    // The code that defines your stack goes here

    // example resource
    // const queue = new sqs.Queue(this, 'AutodumpQueue', {
    //   visibilityTimeout: cdk.Duration.seconds(300)
    // });

    // new AutoDump(this, "AutoDump", {})
  }
}
