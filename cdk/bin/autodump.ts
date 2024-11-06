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
if (!vpcId) {
  throw new Error('vpcId must be defined in the context.');
}
if (!vpcId.match(/^vpc-/)) {
  throw new Error(
    `vpcId must be defined in the context and must start with "vpc-". ${vpcId}`,
  );
}
if (vpcId.length < 10) {
  throw new Error(`vpcId must be longer than 10 characters: ${vpcId}`);
}

const privateSubnetIdsString = app.node.tryGetContext('privateSubnetIds');
if (!privateSubnetIdsString) {
  throw new Error('privateSubnetIds must be defined in the context.');
}
const privateSubnetIds = privateSubnetIdsString.split(',');
if (!privateSubnetIds || !Array.isArray(privateSubnetIds)) {
  throw new Error(
    `privateSubnetIds must be defined in the context and must be an array. Value provided was: ${privateSubnetIds}`,
  );
}
if (privateSubnetIds.length < 2) {
  throw new Error(
    `privateSubnetIds must have at least 2 subnets. Value provided was: ${privateSubnetIdsString}`,
  );
}
for (const subnetId of privateSubnetIds) {
  if (!subnetId.match(/^subnet-/)) {
    throw new Error(
      `SubnetId must start with "subnet-". Value provided was: ${subnetId}`,
    );
  }
}

// get the availability zones and test them
const availabilityZonesString = app.node.tryGetContext('availabilityZones');
if (!availabilityZonesString) {
  throw new Error('availabilityZones must be defined in the context.');
}
const availabilityZones = availabilityZonesString.split(',');
for (const az of availabilityZones) {
  if (!az.match(/^[a-z]{2}-[a-z]+-\d+[a-z]?$/)) {
    throw new Error(
      `AvailabilityZone must match /^[a-z]{2}-[a-z]+-\\d+[a-z]?$/ . Value provided was: ${az}`,
    );
  }
}
if (availabilityZones.length < 2) {
  throw new Error(
    `availabilityZones must have at least 2 availability zones. Value provided was: ${availabilityZones}`,
  );
}

const bucketName = app.node.tryGetContext('bucketName');
const createReadOnlyUser = app.node.tryGetContext('createReadOnlyUser');

new AutoDumpStack(app, 'AutoDump', {
  vpcId: vpcId,
  privateSubnetIds: privateSubnetIds,
  availabilityZones: availabilityZones,
  bucketName,
  createReadOnlyUser: createReadOnlyUser === 'true',
  env: {
    account: app.account,
    region: app.region,
  },
});
