import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
// import {AutoDump} from "./autodump-construct";
import { ExtendedStack, ExtendedStackProps } from "truemark-cdk-lib/aws-cdk";
import * as Ec2 from "aws-cdk-lib/aws-ec2";
import {FargateComputeEnvironment, FargateComputeEnvironmentProps} from "aws-cdk-lib/aws-batch";
import * as Iam from "aws-cdk-lib/aws-iam";
import {aws_batch as Batch} from "aws-cdk-lib";
import {aws_vpc} from "truemark-cdk-lib";


export class AutoDumpStack extends ExtendedStack {
  constructor(scope: Construct, id: string, props?: ExtendedStackProps) {
    super(scope, id, props);

    const vpc = Ec2.Vpc.fromLookup(this, 'ImportVPC',{
      vpcName: "services"
    });

    // Per AWS Support, any VPC created outside of the local cdk stack will only
    // be visible to cdk by using the deprecated network type PRIVATE_WITH_NAT.
    // He basically told me to use it and forget that it's marked as deprecated.
    // In my sandbox, these are available as SubnetType.ISOLATED.
    const privateSubnets = vpc.selectSubnets({
        subnetType: Ec2.SubnetType.PRIVATE_WITH_NAT,
    });
    // TODO: Write a function that queries all the possible private subnet types
    // so a subnet type error can be handled.
    // function getPrivateSubnets(vpc: vpc ) : {
    //
    //   const subnets = vpc.selectSubnets({
    //                                       subnetType: SubnetType.PRIVATE_WITH_NAT,
    //                                     });
    //
    //   const privateWithNatSubnets= vpc.selectSubnets({
    //       subnetType: vpc.SubnetType.PRIVATE_WITH_NAT,
    //   }).subnets.map(subnet => subnet.subnetId);
    //
    //   const privateIsolatedSubnets = vpc.selectSubnets({
    //     subnetType: vpc.SubnetType.PRIVATE_ISOLATED,
    //   }).subnets.map(subnet => subnet.subnetId);
    //
    //   const privateSubnets = vpc.selectSubnets({
    //     subnetType: vpc.SubnetType.PRIVATE,
    //   }).subnets.map(subnet => subnet.subnetId);
    //
    //   return {
    //     privateWithNatSubnets,
    //     privateIsolatedSubnets,
    //     privateSubnets,
    //   };
    // }


    const fargateComputeEnvironmentProps: FargateComputeEnvironmentProps = {
      "vpc" : vpc,
      "vpcSubnets": privateSubnets,
      "spot" : false,
      "computeEnvironmentName": "autodump",
      "maxvCpus": 4,
    }

    const computeEnvironment : FargateComputeEnvironment = new FargateComputeEnvironment(this, 'AutoDump', fargateComputeEnvironmentProps);

    // role and policies required
    const stsAssumeRoleStatement = new Iam.PolicyStatement({
      effect: Iam.Effect.ALLOW,
      actions: ["sts:AssumeRole"],
      resources: ["*"]
    });

    const batchServiceRole = new Iam.Role(this, "autodump-service-role", {
      assumedBy: new Iam.ServicePrincipal("batch.amazonaws.com"),
      managedPolicies: [Iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSBatchServiceRole"),
      Iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AmazonECSTaskExecutionRolePolicy")],
    });
    batchServiceRole.addToPolicy(stsAssumeRoleStatement);

    let ps= new Iam.PolicyStatement({
      actions:["batch:*"],
      effect: Iam.Effect.ALLOW,
      resources:["*"]});
    batchServiceRole.addToPolicy(ps);

    const jobQueue = new Batch.JobQueue(this, "AutoDumpQueue", {
      computeEnvironments: [{
          computeEnvironment,
        order: 1,},
      ],
      enabled: true,
      jobQueueName: "autodump3"
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
  }
}
