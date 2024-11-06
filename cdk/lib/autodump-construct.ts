import {Construct} from 'constructs';
import {
  CompositePrincipal,
  Effect,
  ManagedPolicy,
  PolicyStatement,
  Role,
  ServicePrincipal,
  User,
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
  Parallel,
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
import {RemovalPolicy, Size} from 'aws-cdk-lib';
import {
  BlockPublicAccess,
  Bucket,
  BucketEncryption,
  ObjectOwnership,
} from 'aws-cdk-lib/aws-s3';
import {
  BatchSubmitJob,
  BatchSubmitJobProps,
  LambdaInvoke,
} from 'aws-cdk-lib/aws-stepfunctions-tasks';
import {
  Rule,
  RuleTargetInput,
  // RuleTargetInputProperties,
  Schedule,
} from 'aws-cdk-lib/aws-events';
import {LambdaFunction} from 'aws-cdk-lib/aws-events-targets';

/**
 * Properties for the AutoDump construct.
 */
export interface AutoDumpProps {
  readonly tagPrefix?: string; // TODO This appears to be unused
  /**
   * The VPC ID to run AutoDump in.
   */
  readonly vpcId: string;
  /**
   * The private subnets to run AutoDump in.
   */
  readonly privateSubnetIds: string[];
  /**
   * The availability zones to run AutoDump in.
   */
  readonly availabilityZones: string[];
  /**
   * The bucket name to use. If one is not provided, a generated name is used.
   */
  readonly bucketName?: string;
  /**
   * Set to true to create a read-only IAM user. Default is false. No secret key is generated.
   */
  readonly createReadOnlyUser?: boolean;
}

/**
 * Primary construct for AutoDump.
 */
export class AutoDump extends Construct {
  constructor(scope: Construct, id: string, props: AutoDumpProps) {
    super(scope, id);

    const stackName = 'autodump'; // TODO Not sure why this is harcoded

    const vpc = Vpc.fromVpcAttributes(this, 'Vpc', {
      vpcId: props.vpcId,
      availabilityZones: props.availabilityZones,
      privateSubnetIds: props.privateSubnetIds,
    });

    // TODO You cannot assume this, you must pass in one or more subnetIds as part of the AutoDumpProps class. : fixed
    const specificSubnets: SubnetSelection = {
      subnets: props.privateSubnetIds.map((id) =>
        Subnet.fromSubnetId(this, `Subnet${id}`, id),
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
    const rescheduleFunction = new ScannerFunction(this, 'RescheduleFunction', {
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
        fargateComputeEnvironmentProps,
      );

    // Create the stack service role, allow batch, step functions and ecs as principals, attach required managed policies.
    const batchServiceRole = new Role(this, 'ServiceRole', {
      assumedBy: new CompositePrincipal(
        new ServicePrincipal('batch.amazonaws.com'),
        new ServicePrincipal('ecs.amazonaws.com'),
        new ServicePrincipal('ecs-tasks.amazonaws.com'),
        new ServicePrincipal('states.amazonaws.com'),
      ),
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName(
          'service-role/AWSBatchServiceRole',
        ),
        ManagedPolicy.fromAwsManagedPolicyName(
          'service-role/AmazonECSTaskExecutionRolePolicy',
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
      }),
    );

    batchServiceRole.addToPolicy(
      new PolicyStatement({
        actions: ['secretsmanager:GetSecretValue'],
        effect: Effect.ALLOW,
        resources: ['*'],
      }),
    );

    const autoDumpBucket = new Bucket(this, 'Archive', {
      // Do not allow public access
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,

      // Disables ACLs on the bucket and policies are used to define access
      objectOwnership: ObjectOwnership.BUCKET_OWNER_ENFORCED,

      // Encrypt using S3 keys
      encryption: BucketEncryption.S3_MANAGED, // TODO We should support the use of KMS keys for encryption

      // Force the use of SSL
      enforceSSL: true,

      // Do not setup versioning
      versioned: false,

      // Allow the bucket to be removed or objects to be automatically purged based on pass parameter
      bucketName: props.bucketName,

      // The bucket should be retained in the event of stack deletion
      removalPolicy: RemovalPolicy.RETAIN,

      // Delete old dump files
      lifecycleRules: [
        {
          expiration: Duration.days(7), // TODO Should be configurable as an input parameter
          enabled: true,
        },
      ],
    });

    if (props.createReadOnlyUser) {
      const user = new User(this, 'ReadOnlyUser');
      autoDumpBucket.grantRead(user);
    }

    const addExecutionContext = new Pass(this, 'Add Execution Context', {
      parameters: {
        'Execution.$': '$$.Execution',
        'State.$': '$$.State',
        'StateMachine.$': '$$.StateMachine',
        'SecretArn': JsonPath.stringAt('$.resourceId'),
        'TagsHash': JsonPath.stringAt('$.tagsHash'),
        'When': JsonPath.stringAt('$.when'),
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
        new ServicePrincipal('states.amazonaws.com'),
      ),
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName(
          'service-role/AmazonECSTaskExecutionRolePolicy',
        ),
      ],
    });

    jobRole.addToPolicy(
      new PolicyStatement({
        actions: ['secretsmanager:GetSecretValue'],
        effect: Effect.ALLOW,
        resources: ['*'],
      }),
    );

    jobRole.addToPolicy(
      new PolicyStatement({
        actions: ['s3:PutObject'],
        effect: Effect.ALLOW,
        resources: [autoDumpBucket.bucketArn, autoDumpBucket.bucketArn + '/*'],
      }),
    );

    jobRole.addToPolicy(
      new PolicyStatement({
        actions: ['kms:Decrypt'],
        effect: Effect.ALLOW,
        resources: ['*'],
      }),
    );

    // Create an ECS Job Definition but define the container as Fargate. Per AWS Support,
    // this is the only way it works
    const job = new EcsJobDefinition(this, 'JobDefinition', {
      container: new EcsFargateContainerDefinition(
        this,
        'FargateAutoDumpDefinition',
        {
          image: ContainerImage.fromRegistry(
            'public.ecr.aws/truemark/autodump:latest',
          ),
          memory: Size.gibibytes(2),
          cpu: 1,
          executionRole: batchServiceRole,
          logging: logDriver,

          command: ['/usr/local/bin/dumpdb.sh'],
          jobRole: jobRole,
        },
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

    const rescheduleFunctionTask = new LambdaInvoke(this, 'Reschedule', {
      lambdaFunction: rescheduleFunction,
      // other LambdaInvoke properties
    });
    const definition = DefinitionBody.fromChainable(
      addExecutionContext
        .next(wait)
        .next(getHash)
        .next(
          new Choice(this, 'Do the hashes match?')
            .when(
              Condition.booleanEquals('$.LambdaOutput.Payload.execute', false),
              jobSuccess, // TODO The job shouldn' fail just because the hashes match. A failure implies an error and this is not an error condition. The idea is that if someone changes the schedule by updating the tag the hash won't match so we just silently exit this run and let the new schedule play out which should be a separate state machine execution. :fixed
            )
            .when(
              Condition.booleanEquals('$.LambdaOutput.Payload.execute', true),
              new Parallel(this, 'Run Lambdas in parallel')
                .branch(rescheduleFunctionTask)
                .branch(
                  new BatchSubmitJob(
                    this,
                    'Fire Batch job',
                    batchSubmitJobProps,
                  ),
                )
                .next(
                  new Choice(this, 'Did both Lambdas complete successfully?')
                    .when(
                      Condition.and(
                        Condition.numberEquals('$[0].StatusCode', 200),
                        Condition.stringEquals('$[1].Status', 'SUCCEEDED'),
                      ),
                      jobSuccess,
                    )
                    .otherwise(jobFailed),
                ),
            ),
        ),
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
      }),
    );

    batchServiceRole.addToPolicy(
      new PolicyStatement({
        actions: ['s3:PutObject'],
        effect: Effect.ALLOW,
        resources: [autoDumpBucket.bucketArn],
      }),
    );

    interface AutoDumpRuleTargetInputProperties {
      readonly input: string;
    }

    const ruleTargetInputProps: AutoDumpRuleTargetInputProperties = {
      input: `{"stateMachineArn": "${stateMachine.stateMachineArn}"}`,
    };

    const secretsManagerTagChangePattern = {
      detail: {
        eventSource: ['secretsmanager.amazonaws.com'],
        eventName: ['TagResource', 'UntagResource', 'CreateSecret'],
      },
    };

    const secretsManagerTagChangeRule = new Rule(
      this,
      'SecretsManagerTagChangeRule',
      {
        eventPattern: secretsManagerTagChangePattern,
        description:
          'Routes tag events in Secrets Manager to AutoDump Step Function',
      },
    );

    //   Call scanner with a reference to the secret ARN and the state machine ARN.
    secretsManagerTagChangeRule.addTarget(
      new LambdaFunction(scannerFunction, {
        event: RuleTargetInput.fromObject(ruleTargetInputProps),
      }),
    );

    // Fire the scanner lambda daily at midnight UTC.
    const schedule = Schedule.cron({
      minute: '53',
      hour: '14',
    });

    // This will show up as unused, because it's scheduled.
    new Rule(this, 'ScheduleRule', {
      schedule,
      targets: [
        new LambdaFunction(scannerFunction, {
          event: RuleTargetInput.fromObject(ruleTargetInputProps),
        }),
      ],
    });
  }
}
