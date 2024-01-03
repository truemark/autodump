import {Construct} from "constructs"
import {IEventBus, Rule} from "aws-cdk-lib/aws-events"
import * as Iam from "aws-cdk-lib/aws-iam"

//import * as Batch from "aws-cdk-lib/aws-batch"
import { aws_batch as Batch } from 'aws-cdk-lib'

import * as Ec2 from "aws-cdk-lib/aws-ec2"
import { FargateComputeEnvironmentProps, FargateComputeEnvironment } from 'aws-cdk-lib/aws-batch';

export interface AutoDumpProps {
    readonly tagPrefix?: string;
    readonly eventBus?: IEventBus;
}

export class AutoDump extends Construct {
    constructor(scope: Construct, id: string, props: AutoDumpProps) {
        super(scope, id);
    }}