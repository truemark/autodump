#!/usr/bin/env node
import 'source-map-support/register';
import {AutoDumpStack} from '../lib/autodump-stack';
import {ExtendedApp} from 'truemark-cdk-lib/aws-cdk';

const app = new ExtendedApp();

new AutoDumpStack(app, 'AutoDump', {
  // These entries below are a testing stub. The intended use for this
  // stack is to pass these three values in as parameters.
  vpcId: 'vpc-0dac458b5d1542764', // TODO Populate from your dev account, it's fine to check in, we'll remove it later
  privateSubnetIds: [
    'subnet-00cd7a0602e4f0f09',
    'subnet-08e5109899e63da57',
    'subnet-042e37e02217a69d3',
  ], // TODO Populate from your dev account, it's fine to check in, we'll remove it later
  availabilityZones: ['us-west-2a', 'us-west-2c', 'us-west-2c'], // TODO Populate from your dev account, it's fine to check in, we'll remove it later
  env: {account: process.env.account, region: process.env.region},
});
