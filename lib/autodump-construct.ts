import {Construct} from "constructs"
import {CompositePrincipal, Effect, ManagedPolicy, Policy, PolicyDocument, PolicyStatement, Role, ServicePrincipal,} from "aws-cdk-lib/aws-iam";
import {AwsLogDriver, ContainerImage, CpuArchitecture} from 'aws-cdk-lib/aws-ecs';
import {Duration} from 'aws-cdk-lib/core';
import {
  Choice,
  Condition,
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
import {LogGroup} from 'aws-cdk-lib/aws-logs';
import {ScannerFunction} from "./scanner-function";
import {HashFunction} from "./hash-function";
import {SubnetType, Vpc} from "aws-cdk-lib/aws-ec2";
import {
  EcsFargateContainerDefinition,
  EcsJobDefinition,
  FargateComputeEnvironment,
  FargateComputeEnvironmentProps,
  JobQueue
} from 'aws-cdk-lib/aws-batch';
import {Size, Stack, Tags} from "aws-cdk-lib";
import {BlockPublicAccess, Bucket, BucketEncryption} from "aws-cdk-lib/aws-s3";
import {BatchSubmitJob, BatchSubmitJobProps, LambdaInvoke} from "aws-cdk-lib/aws-stepfunctions-tasks";

export interface AutoDumpProps {
  readonly tagPrefix?: string;
  readonly vpcId: string;
  readonly privateSubnetIds: string[];
  readonly availabilityZones: string[];
}

export class AutoDump extends Construct {
  constructor(scope: Construct, id: string, props: AutoDumpProps) {
    super(scope, id);

    const stackName = "autodump"
    const currentAccount = Stack.of(this).account;

    const vpc = Vpc.fromVpcAttributes(this, 'Vpc', {
      vpcId: props.vpcId,
      availabilityZones: props.availabilityZones,
      privateSubnetIds: props.privateSubnetIds,
    });

    // Per AWS Support, any VPC created outside of the local cdk stack will only
    // be visible to cdk by using the deprecated network type PRIVATE_WITH_NAT.
    // He basically told me to use it and forget that it's marked as deprecated.
    // In my sandbox, these are available as SubnetType.ISOLATED.
    // TODO: Write a function that queries all the possible private subnet types
    // so a subnet type error can be handled.
    const privateSubnets = vpc.selectSubnets({
      subnetType: SubnetType.PRIVATE_WITH_NAT,
      // My sandbox has "PRIVATE_ISOLATED" private su
      // subnetType: SubnetType.PRIVATE_WITH_EGRESS,
      // subnetType: SubnetType.PRIVATE_ISOLATED,
    });

    const fargateComputeEnvironmentProps: FargateComputeEnvironmentProps = {
      "vpc": vpc,
      "vpcSubnets": privateSubnets,
      "spot": false,
      "maxvCpus": 4,
    }

    const scannerFunction = new ScannerFunction(this, "ScannerFunction", {tagName: "autodump:start-schedule"});
    const hashFunction = new HashFunction(this, "HashFunction", {secretArn: "", initialHash: ""});

    const computeEnvironment: FargateComputeEnvironment =
      new FargateComputeEnvironment(this, "FargateComputeEnvironment", fargateComputeEnvironmentProps);

    // Create the stack service role, allow batch, step functions and ecs as principals, attach required managed policies.
    const batchServiceRole = new Role(this, "ServiceRole", {
      assumedBy: new CompositePrincipal(
        new ServicePrincipal("batch.amazonaws.com"),
        new ServicePrincipal("ecs.amazonaws.com"),
        new ServicePrincipal("ecs-tasks.amazonaws.com"),
        new ServicePrincipal("states.amazonaws.com")),
      managedPolicies: [ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSBatchServiceRole"),
        ManagedPolicy.fromAwsManagedPolicyName("service-role/AmazonECSTaskExecutionRolePolicy")],
    });

    const tagCondition = {
      'aws:RequestTag/autodump:start-schedule': 'true',
    };

    batchServiceRole.addToPolicy(new PolicyStatement({
      actions: ["batch:*"],
      effect: Effect.ALLOW,
      conditions: {"StringEquals": tagCondition},
      resources: ["*"]
    }));

    batchServiceRole.addToPolicy(new PolicyStatement({
      actions: ["secretsmanager:GetSecretValue"],
      effect: Effect.ALLOW,
      resources: ["*"]
    }));


    const autoDumpBucket = new Bucket(this, 'Archive', {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
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

    const logGroup = new LogGroup(this, "LogGroup", {});
    const logDriver = new AwsLogDriver({
      streamPrefix: `${stackName}-`,
      logGroup: logGroup,
    });

    const wait = new Wait(this, "Wait for execution time", {
      "time": WaitTime.timestampPath("$.When")
    });

    const jobQueue = new JobQueue(this, "JobQueue", {
      computeEnvironments: [{
        computeEnvironment,
        order: 1,
      },
      ],
      enabled: true,
    });

    const jobSuccess = new Succeed(this, 'Success');

    const jobFailed = new Fail(this, 'Failure', {
      cause: 'AutoDump failed with unspecified error.',
      error: 'AutoDump failed with unspecified error.'
    });

    const jobRole = new Role(this, "JobRole", {
      assumedBy: new CompositePrincipal(
        new ServicePrincipal("batch.amazonaws.com"),
        new ServicePrincipal("ecs-tasks.amazonaws.com"),
        new ServicePrincipal("states.amazonaws.com")),
      managedPolicies: [ManagedPolicy.fromAwsManagedPolicyName("service-role/AmazonECSTaskExecutionRolePolicy")],
    });

    jobRole.addToPolicy(new PolicyStatement({
          actions: [
            "secretsmanager:GetSecretValue"
          ],
          effect: Effect.ALLOW,
          resources: ["*"]
        }
    ));

    jobRole.addToPolicy(new PolicyStatement({
        actions: [
          "s3:PutObject"
        ],
        effect: Effect.ALLOW,
        resources: [
          autoDumpBucket.bucketArn,
          autoDumpBucket.bucketArn + "/*"
        ]
      }
    ));

    jobRole.addToPolicy(new PolicyStatement({
        actions: [
          "kms:Decrypt"
        ],
        effect: Effect.ALLOW,
        resources: ["*"]
      }
    ));

    // Create an ECS Job Definition but define the container as Fargate. Per AWS Support,
    // this is the only way it works
    const job = new EcsJobDefinition(this, 'JobDefinition', {
      container: new EcsFargateContainerDefinition(this, 'FargateAutoDumpDefinition', {
        image: ContainerImage.fromRegistry('public.ecr.aws/truemark/autodump:latest'),
        memory: Size.gibibytes(2),
        cpu: 1,
        executionRole: batchServiceRole,
        logging: logDriver,
        command: ["/usr/local/bin/dumpdb.sh"],
        // jobRole: batchServiceRole
        jobRole: jobRole
      }),
    });

    const batchSubmitJobProps: BatchSubmitJobProps = {
      jobDefinitionArn: job.jobDefinitionArn,
      jobName: job.jobDefinitionName,
      jobQueueArn: jobQueue.jobQueueArn,
      containerOverrides: {
        environment: {
          // "SECRET_ARN": JsonPath.stringAt('$.Secret'),
          "SECRET_ARN": JsonPath.stringAt('$.Secret'),
        },
      }
    };

    const getHash = new LambdaInvoke(this, "GetHash", {
      stateName: "Get current secret tag hash",
      lambdaFunction: hashFunction,
      inputPath: "$",
      resultPath: "$.LambdaOutput"
    });


    const definition = DefinitionBody.fromChainable(addExecutionContext
      .next(wait)
      .next(getHash)
      .next(new Choice(this, 'Hashes match?')
        .when(Condition.booleanEquals('$.LambdaOutput.Payload.execute', false), jobFailed)
        .when(Condition.booleanEquals('$.LambdaOutput.Payload.execute', true),
          new BatchSubmitJob(this, 'Fire batch job', batchSubmitJobProps).next(new Choice(this, 'Job succeeded')
            .when(Condition.stringEquals('$.status', 'SUCCEEDED'), jobSuccess)
            .otherwise(jobFailed)
          ))));


    const stateMachine = new StateMachine(this, "Default", {
      definitionBody: definition,
      logs: {
        destination: logGroup,
        level: LogLevel.ALL,
      },
      role: batchServiceRole,
      timeout: Duration.hours(6),
      comment: 'Database dump state machine.',
    });

    stateMachine.grantStartExecution(scannerFunction);
    stateMachine.addToRolePolicy(new PolicyStatement({
      actions: ["batch:*"],
      effect: Effect.ALLOW,
      resources: ["*"]
    }));

    autoDumpBucket.addLifecycleRule({
      expiration: Duration.days(7), // specify the number of days after which objects should be deleted
      enabled: true,
    });

    batchServiceRole.addToPolicy(new PolicyStatement({
      actions: ["s3:PutObject"],
      effect: Effect.ALLOW,
      resources: [autoDumpBucket.bucketArn]
    }));
}}

