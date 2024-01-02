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

    const vpc = Ec2.Vpc.fromLookup(this, 'ImportVPC',{
        vpcName: "services"
    });

    const privateSubnets = vpc.selectSubnets({
        subnetType: Ec2.SubnetType.PRIVATE_WITH_EGRESS,
    });

    const fargateComputeEnvironmentProps: FargateComputeEnvironmentProps = {
        "vpc" : vpc,
        "vpcSubnets": privateSubnets,
        "spot" : false,
        "computeEnvironmentName": "autodump",
        "maxvCpus": 4,
    }

    const computeEnvironment : FargateComputeEnvironment = new FargateComputeEnvironment(this, 'AutoDump', fargateComputeEnvironmentProps);

    const stsAssumeRoleStatement = new Iam.PolicyStatement({
        effect: Iam.Effect.ALLOW,
        actions: ["sts:AssumeRole"],
        resources: ["*"]
    });

    const batchServiceRole = new Iam.Role(this, "autodump-service-role", {
        assumedBy: new Iam.ServicePrincipal("batch.amazonaws.com"),
        managedPolicies: [Iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSBatchServiceRole")],
    });
    batchServiceRole.addToPolicy(stsAssumeRoleStatement);

    const jobQueue = new Batch.JobQueue(this, "AutoDump", {
        enabled: true,
        jobQueueName: "autodump"
    })

    const jobDefinition = new Batch.CfnJobDefinition(this, "job-definition", {
        // name: 'AutoDump',
        type: "Container",
        containerProperties: {
            command: ["echo", "hello globe"],
            environment: [
                {name: "NAME", value: "AutoDump"}
            ],
            image: "docker.io/library/busybox",
            vcpus: 2,
            memory: 4096
        },
        retryStrategy: {
            attempts: 3
        },
        timeout: {
            attemptDurationSeconds: 60
        }
    });


    }}