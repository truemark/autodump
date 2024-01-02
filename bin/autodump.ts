#!/usr/bin/env node
import 'source-map-support/register';
import { AutoDumpStack } from '../lib/autodump-stack';
import { AwsAccount, AwsRegion } from "../lib/enums";
import { ExtendedApp } from "truemark-cdk-lib/aws-cdk";

const app = new ExtendedApp();

if (app.account === AwsAccount.Sandbox && app.region === AwsRegion.Oregon) {
    new AutoDumpStack(app, 'AutoDump', {
        env: { account: '825434587220', region: 'us-west-2' },
    })
};

