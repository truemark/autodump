import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
// import {AutoDump} from "./autodump-construct";
import { ExtendedStack, ExtendedStackProps } from "truemark-cdk-lib/aws-cdk";
import * as Ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";

import {FargateComputeEnvironment, FargateComputeEnvironmentProps} from "aws-cdk-lib/aws-batch";
import * as Iam from "aws-cdk-lib/aws-iam";
// import {aws_batch as Batch} from "aws-cdk-lib";
import {aws_vpc} from "truemark-cdk-lib";
import * as batch from "aws-cdk-lib/aws-batch";


export class AutoDumpStack extends ExtendedStack {
  constructor(scope: Construct, id: string, props?: ExtendedStackProps) {
    super(scope, id, props);

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
      subnetType: Ec2.SubnetType.PRIVATE_WITH_NAT,
    });

    const fargateComputeEnvironmentProps: FargateComputeEnvironmentProps = {
      "vpc": vpc,
      "vpcSubnets": privateSubnets,
      "spot": false,
      "computeEnvironmentName": "autodump",
      "maxvCpus": 4,
    }

    // Create an ECS Job Definition but define the container as Faragte
    const ecsJob = new batch.EcsJobDefinition(this, 'JobDefn', {
      container: new batch.EcsFargateContainerDefinition(this, 'FargateCDKJobDef', {
        image: ecs.ContainerImage.fromRegistry("docker.io/library/busybox"),
        memory: cdk.Size.gibibytes(2),
        cpu: 1,
      }),
    });


    // https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_events_targets.BatchJob.html#example

    const computeEnvironment: FargateComputeEnvironment =
        new FargateComputeEnvironment(this, 'AutoDump', fargateComputeEnvironmentProps);

    // // Create the stack service role, allow batch and ecs as principals, and attach required managed policies.
     const batchServiceRole = new Iam.Role(this, "autodump-service-role", {
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

    const jobQueue = new batch.JobQueue(this, "AutoDumpQueue", {
      computeEnvironments: [{
        computeEnvironment,
        order: 1,
      },
      ],
      enabled: true,
      jobQueueName: "autodump32"
    });


  }};