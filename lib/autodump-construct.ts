import {Construct} from "constructs"
// import {IEventBus} from "aws-cdk-lib/aws-events"
import {
  CompositePrincipal,
  Effect,
  ManagedPolicy,
  PolicyStatement,
  Role,
  ServicePrincipal,
} from "aws-cdk-lib/aws-iam";
import {ContainerImage} from 'aws-cdk-lib/aws-ecs';
import {Duration} from 'aws-cdk-lib/core';
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
import {LogGroup} from 'aws-cdk-lib/aws-logs';
import {Secret} from 'aws-cdk-lib/aws-secretsmanager';
import {ScannerFunction} from "./scanner-function";
import {SubnetType} from "aws-cdk-lib/aws-ec2";
import {Vpc} from "aws-cdk-lib/aws-ec2"
import {
  EcsFargateContainerDefinition,
  EcsJobDefinition,
  JobQueue
} from 'aws-cdk-lib/aws-batch';
import {
  FargateComputeEnvironment,
  FargateComputeEnvironmentProps
} from 'aws-cdk-lib/aws-batch';
import {AwsLogDriver} from "aws-cdk-lib/aws-ecs";
import {
  Size,
  Stack,
  Tags
} from "aws-cdk-lib";
import {
  BlockPublicAccess,
  Bucket,
  BucketEncryption
} from "aws-cdk-lib/aws-s3";
import {
  BatchSubmitJob,
  BatchSubmitJobProps
} from "aws-cdk-lib/aws-stepfunctions-tasks";

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
    // const currentRegion = Stack.of(this).region;

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
    // https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_events_targets.BatchJob.html#example

    const computeEnvironment: FargateComputeEnvironment =
      new FargateComputeEnvironment(this, "fargateComputeEnvironment", fargateComputeEnvironmentProps);

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

    // TODO: change this to reference enum somehow?
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
      actions: ["secretsmanager:GetSecretValue",
        "secretsmanager:ListSecrets",
        "secretsmanager:DescribeSecret"],
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

    const logGroup = new LogGroup(this, "logGroup", {});
    const logDriver = new AwsLogDriver({
      streamPrefix: `${stackName}-`,
      logGroup: logGroup,
    });

    const wait = new Wait(this, "Wait for execution time", {
      "time": WaitTime.timestampPath("$.When")
    });

    const jobQueue = new JobQueue(this, "jobQueue", {
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

    // Create an ECS Job Definition but define the container as Fargate. Per AWS Support,
    // this is the only way it works
    const ecsJob = new EcsJobDefinition(this, 'JobDefinition', {
      container: new EcsFargateContainerDefinition(this, 'FargateAutoDumpDefinition', {
        image: ContainerImage.fromRegistry('public.ecr.aws/truemark/autodump:latest'),
        memory: Size.gibibytes(2),
        cpu: 1,
        executionRole: batchServiceRole,
        logging: logDriver,
        command: ["/usr/local/bin/dumpdb.sh"],
      }),
    });

    const batchSubmitJobProps: BatchSubmitJobProps = {
      jobDefinitionArn: ecsJob.jobDefinitionArn,
      jobName: ecsJob.jobDefinitionName,
      jobQueueArn: jobQueue.jobQueueArn,
      containerOverrides: {
        environment: {
          "SECRET_ARN": JsonPath.stringAt('$.Secret')
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
      timeout: Duration.hours(6),
      comment: 'Database dump state machine.',
    });

    stateMachine.addToRolePolicy(new PolicyStatement({
      actions: ["batch:*"],
      effect: Effect.ALLOW,
      // conditions: {"StringEquals": tagCondition},
      resources: ["*"]
    }));

    // stateMachine.addToRolePolicy(new PolicyStatement({
    //   actions: ["ecr:GetAuthorizationToken"],
    //   effect: Effect.ALLOW,
    //   resources: [ecrRepository.repositoryArn]
    // }));


    autoDumpBucket.addLifecycleRule({
      expiration: Duration.days(7), // specify the number of days after which objects should be deleted
      enabled: true,
    });

    batchServiceRole.addToPolicy(new PolicyStatement({
      actions: ["s3:PutObject"],
      effect: Effect.ALLOW,
      resources: [autoDumpBucket.bucketArn]
    }));


    // This secret is for testing. It should not live in this stack in the future.
    const dumpSecret = new Secret(this, "Secret", {
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

    Tags.of(dumpSecret).add("autodump:start-schedule", "3 16 - - -");
    // Tags.of(dumpSecret).add("autodump:timezone", "America/New_York");

  }
}
