import {Construct} from "constructs"
import {IEventBus, Rule} from "aws-cdk-lib/aws-events"
import * as Iam from "aws-cdk-lib/aws-iam"
import * as ecr from 'aws-cdk-lib/aws-ecr';
import { DockerImageAsset } from 'aws-cdk-lib/aws-ecr-assets';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as logs from 'aws-cdk-lib/aws-logs';

import * as Ec2 from "aws-cdk-lib/aws-ec2"
import { FargateComputeEnvironmentProps, FargateComputeEnvironment } from 'aws-cdk-lib/aws-batch';
import * as batch from "aws-cdk-lib/aws-batch";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as cdk from "aws-cdk-lib";

export interface AutoDumpProps {
    readonly tagPrefix?: string;
    readonly eventBus?: IEventBus;
}

export class AutoDump extends Construct {
    constructor(scope: Construct, id: string, props?: AutoDumpProps) {
        super(scope, id);

        const stackName = "autodump"

        const vpc = Ec2.Vpc.fromLookup(this, 'ImportVPC', {
            vpcName: "services"
        });

        // Per AWS Support, any VPC created outside of the local cdk stack will only
        // be visible to cdk by using the deprecated network type PRIVATE_WITH_NAT.
        // He basically told me to use it and forget that it's marked as deprecated.
        // In my sandbox, these are available as SubnetType.ISOLATED.
        // TODO: Write a function that queries all the possible private subnet types
        // so a subnet type error can be handled.
        const privateSubnets = vpc.selectSubnets({
            // subnetType: Ec2.SubnetType.PRIVATE_WITH_NAT,
            // My sandbox has "PRIVATE_ISOLATED" private subnets. ???
            subnetType:  Ec2.SubnetType.PRIVATE_ISOLATED,
        });

        const fargateComputeEnvironmentProps: FargateComputeEnvironmentProps = {
            "vpc": vpc,
            "vpcSubnets": privateSubnets,
            "spot": false,
            "computeEnvironmentName": stackName,
            "maxvCpus": 4,
        }

        // Create an ECS Job Definition but define the container as Fargate. Per AWS Support,
        // this is the only way it works
        const ecsJob = new batch.EcsJobDefinition(this, 'JobDefn', {
            container: new batch.EcsFargateContainerDefinition(this, 'FargateCDKJobDef', {
                image: ecs.ContainerImage.fromRegistry("docker.io/library/busybox"),
                memory: cdk.Size.gibibytes(2),
                cpu: 1,
            }),
        });

        // https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_events_targets.BatchJob.html#example

        const computeEnvironment: FargateComputeEnvironment =
            new FargateComputeEnvironment(this, "fargateComputeEnvironment", fargateComputeEnvironmentProps);

        // // Create the stack service role, allow batch and ecs as principals, and attach required managed policies.
        const batchServiceRole = new Iam.Role(this, "ServiceRole", {
            assumedBy: new Iam.CompositePrincipal(new Iam.ServicePrincipal("batch.amazonaws.com"),
                new Iam.ServicePrincipal("ecs.amazonaws.com")),
            managedPolicies: [Iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSBatchServiceRole"),
                Iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AmazonECSTaskExecutionRolePolicy")],
        });

        // Grant the ability to assume this role.
        batchServiceRole.addToPolicy(new Iam.PolicyStatement({
            effect: Iam.Effect.ALLOW,
            actions: ["sts:AssumeRole"],
            resources: ["*"]
        }));

        batchServiceRole.addToPolicy(new Iam.PolicyStatement({
            actions: ["batch:*"],
            effect: Iam.Effect.ALLOW,
            resources: ["*"]
        }));

        const jobQueue = new batch.JobQueue(this, "jobQueue", {
            computeEnvironments: [{
                computeEnvironment,
                order: 1,
            },
            ],
            enabled: true,
            jobQueueName: stackName
        });

        const repository = new ecr.Repository(this, "ecrRepository", {
            repositoryName: stackName
        });

        const asset = new DockerImageAsset(this, "dockerImageAsset", {
            directory: "./resources",
            assetName: stackName
        });

        const jobSuccess = new sfn.Succeed(this, 'Success');

        const jobFailed = new sfn.Fail(this, 'jobFailed', {
            cause: 'RDS Cloning failed with unspecified error.',
            error: 'RDS Cloning failed with unspecified error.'
        });

        const waitY = new sfn.Wait(this, 'Wait 10 Seconds', {
            time: sfn.WaitTime.duration(cdk.Duration.seconds(10))
        });

        const waitX = new sfn.Wait(this, 'Wait 5 seconds', {
            time: sfn.WaitTime.duration(cdk.Duration.seconds(5))
        });

        /**-------------------------------------------------------------------
         * Create the variables to be used in the state machine from the database
         * identifier. They will be used throughout this state machine.
         */
        const createVars = new sfn.Pass(this, 'Create Variables', {
            parameters: {
                "Parameters": {
                    "InitParameters": {
                        "DbCopySharedSnapshotIdentifier.$": "States.Format('{}-cloneprep-copy',$.DbInstanceIdentifier)",
                        "DbCopySnapshotIdentifier.$": "States.Format('{}-cloneprep',$.DbInstanceIdentifier)",
                        "DbInstanceIdentifier.$": "$.DbInstanceIdentifier",
                        "RemoteSharedDbSnapshotIdentifier.$": "States.Format('arn:aws:rds:us-west-2:{}:snapshot:{}-cloneprep','348901320172', $.DbInstanceIdentifier)",
                        "SourceKmsKeyId.$": "$.SourceKmsKeyId",
                        "TargetAccountNumber.$": "$.TargetAccountNumber",
                        "TargetKmsKeyId.$": "$.TargetKmsKeyId",
                        "TargetStateMachineArn.$": "$.TargetStateMachineArn",
                    }
                }
            }
        });

        const logGroup = new logs.LogGroup(this, '/ClonePrepSource/', {});
        const definition = createVars

        const sMachine = new sfn.StateMachine(this, "StateMachine", {
            definition,
            logs: {
                destination: logGroup,
                level: sfn.LogLevel.ALL,
            },
            timeout: cdk.Duration.hours(6),
            comment: 'Create snapshot copy for cloning, and share to nonprod account.',
        });

    }};