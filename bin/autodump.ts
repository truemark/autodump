#!/usr/bin/env node
import 'source-map-support/register';
import { AutoDumpStack } from '../lib/autodump-stack';
import * as cdk from 'aws-cdk-lib';
import { ExtendedApp, ExtendedAppProps } from "truemark-cdk-lib/aws-cdk";

const app = new ExtendedApp();
// const app = new cdk.App();


new AutoDumpStack(app, 'AutoDump', {
    env: { account: process.env.account, region: process.env.region},
});



