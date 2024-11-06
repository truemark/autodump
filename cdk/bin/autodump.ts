#!/usr/bin/env node
import 'source-map-support/register';
import {AutoDumpStack} from '../lib/autodump-stack';
import {ExtendedApp} from 'truemark-cdk-lib/aws-cdk';

const app = new ExtendedApp({
  standardTags: {
    automationTags: {
      id: 'autodump',
      url: 'https://github.com/truemark/autodump',
    },
  },
});

const vpcId = app.node.tryGetContext('vpcId');
// The only thing we can specifically say about the vpcId is that it starts
// with "vpc-" and is longer than 10 characters (has a suffix).
if (!vpcId || !vpcId.match(/^vpc-/)) {
  throw new Error(
    `vpcId must be defined in the context and must start with "vpc-". ${vpcId}`
  );
}

if (vpcId.length < 10) {
  throw new Error(`vpcId must be longer than 10 characters: ${vpcId}`);
}

// There must be at least 2 private subnets, and they must start with "subnet-".
const privateSubnetIdsString = app.node.tryGetContext('privateSubnetIds');
const privateSubnetIds = privateSubnetIdsString.split(',');

if (!privateSubnetIds || !Array.isArray(privateSubnetIds)) {
  throw new Error(
    `privateSubnetIds must be defined in the context and must be an array. Value provided was: ${privateSubnetIds}`
  );
}

if (privateSubnetIds.length < 2) {
  throw new Error(
    `privateSubnetIds must have at least 2 subnets. Value provided was: {privateSubnetIds}`
  );
}

for (const subnetId of privateSubnetIds) {
  if (!subnetId.match(/^subnet-/)) {
    throw new Error(`SubnetId must start with "subnet-". Value provided was: ${subnetId}`);
  }
}

// get the availability zones and test them
const availabilityZonesString = app.node.tryGetContext('availabilityZones');

let availabilityZones: string[] = [];
try {
  availabilityZones = availabilityZonesString.split(',');
} catch (error) {
  throw new Error(
    `availabilityZones must be comma-separated list. Value provided was: ${availabilityZones}`
  );
}

for (const az of availabilityZones) {
  if (!az.match(/^[a-z]{2}-[a-z]+-\d+[a-z]?$/)) {
    throw new Error(
      `AvailabilityZone must match /^[a-z]{2}-[a-z]+-\\d+[a-z]?$/ . Value provided was: ${az}`
    );
  }
}

if (availabilityZones.length < 2) {
  throw new Error(
    `availabilityZones must have at least 2 availability zones. Value provided was: ${availabilityZones}`
  );
}

// The account must be defined in the context, and it must be 12 numbers long
const account = app.node.tryGetContext('account');
if (!account) {
  throw new Error('account must be defined in the context.');
}

if (account.length !== 12) {
  throw new Error(`account must be 12 characters long. Value provided was: ${account}`);
}

function isNumeric(str: string): boolean {
  return /^[0-9]+$/.test(str);
}
if (!isNumeric(account)) {
  throw new Error(`account must be numeric. Value provided was:  ${account}`);
}

// The region must be defined, it must be a string, it must include two hyphens,
// start with 2 characters, and end with a number and a character. .
const region = app.node.tryGetContext('region');

if (!region) {
  throw new Error('region must be defined in the context.');
}

if (!region.match(/^[a-z]{2}-[a-z]+-\d+[a-z]?$/)) {
  throw new Error(
    `Region must match format xx-xxxx-0x. For example, us-west-2a. Value currently is ${region}`
  );
}

new AutoDumpStack(app, 'AutoDump', {
  vpcId: vpcId,
  privateSubnetIds: privateSubnetIds,
  availabilityZones: availabilityZones,
  env: {
    account: account,
    region: region,
  },
});
