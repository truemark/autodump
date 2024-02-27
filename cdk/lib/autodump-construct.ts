import {Construct} from 'constructs';
import {
  CompositePrincipal,
  Effect,
  ManagedPolicy,
  PolicyStatement,
  Role,
  ServicePrincipal,
} from 'aws-cdk-lib/aws-iam';
import {AwsLogDriver, ContainerImage} from 'aws-cdk-lib/aws-ecs';
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
  WaitTime,
} from 'aws-cdk-lib/aws-stepfunctions';
import {LogGroup} from 'aws-cdk-lib/aws-logs';
import {ScannerFunction} from './scanner-function';
import {HashFunction} from './hash-function';
import {SubnetSelection, Subnet, Vpc} from 'aws-cdk-lib/aws-ec2';
import {
  EcsFargateContainerDefinition,
  EcsJobDefinition,
  FargateComputeEnvironment,
  FargateComputeEnvironmentProps,
  JobQueue,
} from 'aws-cdk-lib/aws-batch';
import {Size} from 'aws-cdk-lib';
import {BlockPublicAccess, Bucket, BucketEncryption} from 'aws-cdk-lib/aws-s3';
import {
  BatchSubmitJob,
  BatchSubmitJobProps,
  LambdaInvoke,
} from 'aws-cdk-lib/aws-stepfunctions-tasks';
import {
  Rule,
  RuleTargetInput,
  RuleTargetInputProperties,
  Schedule,
} from 'aws-cdk-lib/aws-events';
import {LambdaFunction} from 'aws-cdk-lib/aws-events-targets';

export interface AutoDumpProps {
  readonly tagPrefix?: string;
  readonly vpcId: string;
  readonly privateSubnetIds: string[];
  readonly availabilityZones: string[];
}

export class AutoDump extends Construct {
  constructor(scope: Construct, id: string, props: AutoDumpProps) {
    super(scope, id);

    const stackName = 'autodump';

    const vpc = Vpc.fromVpcAttributes(this, 'Vpc', {
      vpcId: props.vpcId,
      availabilityZones: props.availabilityZones,
      privateSubnetIds: props.privateSubnetIds,
    });

    // TODO You cannot assume this, you must pass in one or more subnetIds as part of the AutoDumpProps class. : fixed
    const specificSubnets: SubnetSelection = {
      subnets: props.privateSubnetIds.map(id =>
        Subnet.fromSubnetId(this, `Subnet${id}`, id)
      ),
    };

    const fargateComputeEnvironmentProps: FargateComputeEnvironmentProps = {
      vpc: vpc,
      vpcSubnets: specificSubnets,
      spot: false,
      maxvCpus: 4,
    };

    // TODO I do not see where this is scheduled. I was expecting a scan to be done daily scheduled via event brdige. :fixed
    const scannerFunction = new ScannerFunction(this, 'ScannerFunction', {
      tagName: 'autodump:start-schedule',
    });
    const hashFunction = new HashFunction(this, 'HashFunction', {
      secretArn: '',
      initialHash: '',
    });

    const computeEnvironment: FargateComputeEnvironment =
      new FargateComputeEnvironment(
        this,
        'FargateComputeEnvironment',
        fargateComputeEnvironmentProps
      );

    // Create the stack service role, allow batch, step functions and ecs as principals, attach required managed policies.
    const batchServiceRole = new Role(this, 'ServiceRole', {
      assumedBy: new CompositePrincipal(
        new ServicePrincipal('batch.amazonaws.com'),
        new ServicePrincipal('ecs.amazonaws.com'),
        new ServicePrincipal('ecs-tasks.amazonaws.com'),
        new ServicePrincipal('states.amazonaws.com')
      ),
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName(
          'service-role/AWSBatchServiceRole'
        ),
        ManagedPolicy.fromAwsManagedPolicyName(
          'service-role/AmazonECSTaskExecutionRolePolicy'
        ),
      ],
    });

    const tagCondition = {
      'aws:RequestTag/autodump:start-schedule': 'true',
    };

    batchServiceRole.addToPolicy(
      new PolicyStatement({
        actions: ['batch:*'],
        effect: Effect.ALLOW,
        conditions: {StringEquals: tagCondition},
        resources: ['*'],
      })
    );

    batchServiceRole.addToPolicy(
      new PolicyStatement({
        actions: ['secretsmanager:GetSecretValue'],
        effect: Effect.ALLOW,
        resources: ['*'],
      })
    );

    const autoDumpBucket = new Bucket(this, 'Archive', {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: false,
      lifecycleRules: [
        {
          expiration: Duration.days(7),
          enabled: true,
        },
      ],
    });

    const addExecutionContext = new Pass(this, 'Add Execution Context', {
      parameters: {
        'Execution.$': '$$.Execution',
        'State.$': '$$.State',
        'StateMachine.$': '$$.StateMachine',
        SecretArn: JsonPath.stringAt('$.resourceId'),
        TagsHash: JsonPath.stringAt('$.tagsHash'),
        When: JsonPath.stringAt('$.when'),
      },
    });

    const logGroup = new LogGroup(this, 'LogGroup', {});
    const logDriver = new AwsLogDriver({
      streamPrefix: `${stackName}`,
      logGroup: logGroup,
    });

    const wait = new Wait(this, 'Wait for execution time', {
      time: WaitTime.timestampPath('$.When'),
    });

    const jobQueue = new JobQueue(this, 'JobQueue', {
      computeEnvironments: [
        {
          computeEnvironment,
          order: 1,
        },
      ],
      enabled: true,
    });

    const jobSuccess = new Succeed(this, 'Success');

    const jobFailed = new Fail(this, 'Failure', {
      cause: 'AutoDump failed with unspecified error.',
      error: 'AutoDump failed with unspecified error.',
    });

    const jobRole = new Role(this, 'JobRole', {
      assumedBy: new CompositePrincipal(
        new ServicePrincipal('batch.amazonaws.com'),
        new ServicePrincipal('ecs-tasks.amazonaws.com'),
        new ServicePrincipal('states.amazonaws.com')
      ),
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName(
          'service-role/AmazonECSTaskExecutionRolePolicy'
        ),
      ],
    });

    jobRole.addToPolicy(
      new PolicyStatement({
        actions: ['secretsmanager:GetSecretValue'],
        effect: Effect.ALLOW,
        resources: ['*'],
      })
    );

    jobRole.addToPolicy(
      new PolicyStatement({
        actions: ['s3:PutObject'],
        effect: Effect.ALLOW,
        resources: [autoDumpBucket.bucketArn, autoDumpBucket.bucketArn + '/*'],
      })
    );

    jobRole.addToPolicy(
      new PolicyStatement({
        actions: ['kms:Decrypt'],
        effect: Effect.ALLOW,
        resources: ['*'],
      })
    );

    // Create an ECS Job Definition but define the container as Fargate. Per AWS Support,
    // this is the only way it works
    const job = new EcsJobDefinition(this, 'JobDefinition', {
      container: new EcsFargateContainerDefinition(
        this,
        'FargateAutoDumpDefinition',
        {
          image: ContainerImage.fromRegistry(
            'public.ecr.aws/truemark/autodump:latest'
          ),
          memory: Size.gibibytes(2),
          cpu: 1,
          executionRole: batchServiceRole,
          logging: logDriver,

          command: ['/usr/local/bin/dumpdb.sh'],
          jobRole: jobRole,
        }
      ),
    });

    const batchSubmitJobProps: BatchSubmitJobProps = {
      jobDefinitionArn: job.jobDefinitionArn,
      jobName: job.jobDefinitionName,
      jobQueueArn: jobQueue.jobQueueArn,
      containerOverrides: {
        environment: {
          SECRET_ARN: JsonPath.stringAt('$.SecretArn'),
        },
      },
    };

    const getHash = new LambdaInvoke(this, 'GetHash', {
      stateName: 'Get current secret tag hash',
      lambdaFunction: hashFunction,
      inputPath: '$',
      resultPath: '$.LambdaOutput',
    });

    const definition = DefinitionBody.fromChainable(
      addExecutionContext
        .next(wait)
        .next(getHash)
        .next(
          new Choice(this, 'Do the hashes match?')
            .when(
              Condition.booleanEquals('$.LambdaOutput.Payload.execute', false),
              jobSuccess // TODO The job shouldn' fail just because the hashes match. A failure implies an error and this is not an error condition. The idea is that if someone changes the schedule by updating the tag the hash won't match so we just silently exit this run and let the new schedule play out which should be a separate state machine execution. :fixed
            )
            .when(
              Condition.booleanEquals('$.LambdaOutput.Payload.execute', true),
              new BatchSubmitJob(
                this,
                'Fire batch job',
                batchSubmitJobProps
              ).next(
                new Choice(this, 'Did job complete successfully?')
                  .when(
                    Condition.stringEquals('$.Status', 'SUCCEEDED'),
                    jobSuccess
                  )
                  .otherwise(jobFailed)
              )
            )
        )
      // TODO Where do we schedule the next run? The idea is that there is always a state machine execution running for a secret when it's tagged. When the execution is done, another is started. This is also how autostate works.
      // TODO Continued: So, if I had 2 secrets tagged for autodump. I should be able to look at the state machine and see two executions, one for each database in a waiting state for their time to run.
      // TODO FIXED: Each execution starts with the event bridge rule firing the scanner lambda.
      // TODO I do not see any event bridge rules listening for tag changes to schedule these dump runs.
      // TODO FIXED: Correct. All executions start from the scanner lambda. We discussed leaving listening to tag change events for a future iteration.I will gladly add it if need be.
    );

    const stateMachine = new StateMachine(this, 'Default', {
      definitionBody: definition,
      logs: {
        destination: logGroup,
        level: LogLevel.ALL,
      },
      role: batchServiceRole,
      timeout: Duration.hours(168), // TODO I don't see how this works since a state machine execution could last many days depending on the cron schedule applied in the tag
      // TODO FIXED: bumped hours to 168 = 7 days. We could parameterize this?
      comment: 'Database dump state machine.',
    });

    stateMachine.grantStartExecution(scannerFunction);
    stateMachine.addToRolePolicy(
      new PolicyStatement({
        actions: ['batch:*'],
        effect: Effect.ALLOW,
        resources: ['*'],
      })
    );

    batchServiceRole.addToPolicy(
      new PolicyStatement({
        actions: ['s3:PutObject'],
        effect: Effect.ALLOW,
        resources: [autoDumpBucket.bucketArn],
      })
    );

    // Fire the scanner lambda daily at midnight UTC.
    const schedule = Schedule.cron({
      minute: '53',
      hour: '14',
    });

    interface AutoDumpRuleTargetInputProperties {
      readonly input: string;
    }

    const ruleTargetInputProps: AutoDumpRuleTargetInputProperties = {
      input: `{"stateMachineArn": "${stateMachine.stateMachineArn}"}`,
    };

    const scheduledRule = new Rule(this, 'ScheduleRule', {
      schedule,
      targets: [
        new LambdaFunction(scannerFunction, {
          event: RuleTargetInput.fromObject(ruleTargetInputProps),
        }),
      ],
    });
  }
}
