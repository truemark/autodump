import {Construct} from "constructs"
import {IEventBus} from "aws-cdk-lib/aws-events"
import * as Iam from "aws-cdk-lib/aws-iam"
import * as ecr from 'aws-cdk-lib/aws-ecr';
import {Duration, Fn} from 'aws-cdk-lib/core';
import {
  DefinitionBody,
  Fail,
  JsonPath,
  LogLevel,
  Pass,
  StateMachine,
  Succeed,
  Wait,
  WaitTime
} from "aws-cdk-lib/aws-stepfunctions";
import * as logs from 'aws-cdk-lib/aws-logs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import {ScannerFunction} from "./scanner-function";
import * as Ec2 from "aws-cdk-lib/aws-ec2"
import {Vpc} from 'aws-cdk-lib/aws-ec2';
import * as batch from 'aws-cdk-lib/aws-batch';
import {FargateComputeEnvironment, FargateComputeEnvironmentProps} from 'aws-cdk-lib/aws-batch';
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as cdk from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import {BatchSubmitJob, BatchSubmitJobProps} from "aws-cdk-lib/aws-stepfunctions-tasks";

export interface AutoDumpProps {
  readonly tagPrefix?: string;
  readonly eventBus?: IEventBus; // TODO This doesn't belong. Use the default event bus.
  readonly vpcId: string;
  readonly privateSubnetIds: string[];
  readonly availabilityZones: string[];
}

export class AutoDump extends Construct {
  constructor(scope: Construct, id: string, props: AutoDumpProps) {
    super(scope, id);

    const stackName = "autodump"
    const currentAccount = cdk.Stack.of(this).account;
    // const currentRegion = cdk.Stack.of(this).region;

    const vpc = Vpc.fromVpcAttributes(this, 'Vpc', {
      vpcId: props.vpcId,
      availabilityZones: props.availabilityZones, // TODO Add to props
      privateSubnetIds: props.privateSubnetIds,
    });

    // Per AWS Support, any VPC created outside of the local cdk stack will only
    // be visible to cdk by using the deprecated network type PRIVATE_WITH_NAT.
    // He basically told me to use it and forget that it's marked as deprecated.
    // In my sandbox, these are available as SubnetType.ISOLATED.
    // TODO: Write a function that queries all the possible private subnet types
    // so a subnet type error can be handled.
    const privateSubnets = vpc.selectSubnets({
      subnetType: Ec2.SubnetType.PRIVATE_WITH_NAT,
      // My sandbox has "PRIVATE_ISOLATED" private su
      // subnetType: SubnetType.PRIVATE_WITH_EGRESS,
      // subnetType: Ec2.SubnetType.PRIVATE_ISOLATED,
    });

    const fargateComputeEnvironmentProps: FargateComputeEnvironmentProps = {
      "vpc": vpc,
      "vpcSubnets": privateSubnets,
      "spot": false,
      "maxvCpus": 4,
    }

    const scannerFunction = new ScannerFunction(this, "ScannerFunction", {tagName: "autodump:start-schedule"});
    // https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_events_targets.BatchJob.html#example

    const computeEnvironment: FargateComputeEnvironment =
      new FargateComputeEnvironment(this, "fargateComputeEnvironment", fargateComputeEnvironmentProps);

    // Create the stack service role, allow batch, step functions and ecs as principals, attach required managed policies.
    const batchServiceRole = new Iam.Role(this, "ServiceRole", {
      assumedBy: new Iam.CompositePrincipal(
        new Iam.ServicePrincipal("batch.amazonaws.com"),
        new Iam.ServicePrincipal("ecs.amazonaws.com"),
        new Iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
        new Iam.ServicePrincipal("states.amazonaws.com")),
      managedPolicies: [Iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSBatchServiceRole"),
        Iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AmazonECSTaskExecutionRolePolicy")],
    });

    // TODO: change this to reference enum somehow?
    const tagCondition = {
      'aws:RequestTag/autodump:start-schedule': 'true',
    };

    batchServiceRole.addToPolicy(new Iam.PolicyStatement({
      actions: ["batch:*"],
      effect: Iam.Effect.ALLOW,
      conditions: {"StringEquals": tagCondition},
      resources: ["*"]
    }));

    batchServiceRole.addToPolicy(new Iam.PolicyStatement({
      actions: ["secretsmanager:GetSecretValue",
        "secretsmanager:ListSecrets",
        "secretsmanager:DescribeSecret"],
      effect: Iam.Effect.ALLOW,
      resources: ["*"]
    }));

    const autoDumpBucket = new s3.Bucket(this, 'Archive', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: false,
    });

    const addExecutionContext = new Pass(this, "Add Execution Context", {
      parameters: {
        "Execution.$": "$$.Execution",
        "State.$": "$$.State",
        "StateMachine.$": "$$.StateMachine",
        "Secret": JsonPath.stringAt('$.resourceId'),
        "TagsHash": JsonPath.stringAt('$.tagsHash'),
        "When": JsonPath.stringAt('$.when'),
      }
    });

    const logGroup = new logs.LogGroup(this, "logGroup", {});
    const logDriver = new ecs.AwsLogDriver({
      streamPrefix: `${stackName}-`,
      logGroup: logGroup,
    });

    const wait = new Wait(this, "Wait for execution time", {
      "time": WaitTime.timestampPath("$.When")
    });

    const ecrRepository = new ecr.Repository(this, "ecrRepository", {});

    const ecsImage = ecrRepository.repositoryUriForTag("latest");

    const jobQueue = new batch.JobQueue(this, "jobQueue", {
      computeEnvironments: [{
        computeEnvironment,
        order: 1,
      },
      ],
      enabled: true,
    });

    const jobSuccess = new Succeed(this, 'Success');

    const jobFailed = new Fail(this, 'jobFailed', {
      cause: 'AutoDump failed with unspecified error.',
      error: 'AutoDump failed with unspecified error.'
    });

    // This secret is for testing. It should not live in this stack in the future.
    const dumpSecret = new secretsmanager.Secret(this, "Secret", {
      generateSecretString: {
        secretStringTemplate: JSON.stringify(
          {
            "username": "autodump",
            "port": "5432",
            "databasename": "dumptest",
            "endpoint": "database-1.cp1jdygezzou.us-west-2.rds.amazonaws.com",
            "engine": "postgres",
            "bucketname": autoDumpBucket.bucketName,
          }
        ),
        generateStringKey: 'password',
        excludePunctuation: true,
        passwordLength: 16,
      }
    });

    cdk.Tags.of(dumpSecret).add("autodump:start-schedule", "3 16 - - -");
    // cdk.Tags.of(dumpSecret).add("autodump:timezone", "America/New_York");
    // Create an ECS Job Definition but define the container as Fargate. Per AWS Support,
    // this is the only way it works
    const ecsJob = new batch.EcsJobDefinition(this, 'JobDefn', {
      container: new batch.EcsFargateContainerDefinition(this, 'FargateAutoDumpDefinition', {
        image: ecs.ContainerImage.fromRegistry(ecsImage),
        memory: cdk.Size.gibibytes(2),
        cpu: 1,
        executionRole: batchServiceRole,
        logging: logDriver,
        command: ["/app/dumpdb.sh"],
      }),
    });

    const batchSubmitJobProps: BatchSubmitJobProps = {
      jobDefinitionArn: ecsJob.jobDefinitionArn,
      jobName: ecsJob.jobDefinitionName,
      jobQueueArn: jobQueue.jobQueueArn,
      containerOverrides: {
        environment:           {
           "SECRET_ARN" :  JsonPath.stringAt('$.Secret')
          }
      }
    };

    const definition = DefinitionBody.fromChainable(addExecutionContext
      .next(wait)
      .next(new BatchSubmitJob(this, 'Fire batch job', batchSubmitJobProps))
      .next(jobSuccess)
    );

    const stateMachine = new StateMachine(this, "Default", {
      definitionBody: definition,
      logs: {
        destination: logGroup,
        level: LogLevel.ALL,
      },
      role: batchServiceRole,
      timeout: cdk.Duration.hours(6),
      comment: 'Database dump state machine.',
    });

    stateMachine.addToRolePolicy(new Iam.PolicyStatement({
      actions: ["batch:*"],
      effect: Iam.Effect.ALLOW,
      // conditions: {"StringEquals": tagCondition},
      resources: ["*"]
    }));
    stateMachine.addToRolePolicy(new Iam.PolicyStatement({
      actions: ["ecr:GetAuthorizationToken"],
      effect: Iam.Effect.ALLOW,
      resources: [ecrRepository.repositoryArn]
    }));




    autoDumpBucket.addLifecycleRule({
      expiration: Duration.days(7), // specify the number of days after which objects should be deleted
      enabled: true,
    });

    batchServiceRole.addToPolicy(new Iam.PolicyStatement({
      actions: ["s3:PutObject"],
      effect: Iam.Effect.ALLOW,
      resources: [autoDumpBucket.bucketArn]
    }));


  }
}

