#!/usr/bin/env node
import 'source-map-support/register';
import {AutoDumpStack} from '../lib/autodump-stack';
import {ExtendedApp} from 'truemark-cdk-lib/aws-cdk';

const app = new ExtendedApp();

// vodev 062758075735 specific variable values
// new AutoDumpStack(app, 'AutoDump', {
//   // These entries below are a testing stub. The intended use for this
//   // stack is to pass these three values in as parameters.
//   vpcId: 'vpc-0a8b6fc80c876792a',
//   privateSubnetIds: [
//     'subnet-0d295f3dae681e96b',
//     'subnet-0906198d4b2c6ae8c',
//     'subnet-0294bf9a3f2e08867',
//   ],
//   availabilityZones: ['us-west-2a', 'us-west-2c', 'us-west-2c'],
//   env: {account: process.env.account, region: process.env.region},
// });

// supply chain sandbox
new AutoDumpStack(app, 'AutoDump', {
  // These entries below are a testing stub. The intended use for this
  // stack is to pass these three values in as parameters.
  vpcId: 'vpc-0dac458b5d1542764', // TODO Populate from your dev account, it's fine to check in, we'll remove it later
  privateSubnetIds: [
    // TODO You pass these in, but them proceed to not use them in your autodump-construct. : fixed in autodump-construct
    'subnet-00cd7a0602e4f0f09',
    'subnet-08e5109899e63da57',
    'subnet-042e37e02217a69d3',
  ], // TODO Populate from your dev account, it's fine to check in, we'll remove it later
  availabilityZones: ['us-west-2a', 'us-west-2c', 'us-west-2c'], // TODO Populate from your dev account, it's fine to check in, we'll remove it later
  env: {account: process.env.account, region: process.env.region},
});
