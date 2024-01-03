#!/usr/bin/env node
import 'source-map-support/register';
import { AutoDumpStack } from '../lib/autodump-stack';
import { AwsAccount, AwsRegion } from "../lib/enums";
import { ExtendedApp, ExtendedAppProps } from "truemark-cdk-lib/aws-cdk";

const app = new ExtendedApp();

if (app.account === AwsAccount.LkSandbox && app.region === AwsRegion.Oregon) {
    console.log("deploying---------->" + app.account)
// Is it possible to reference a variable in the env statement?
    new AutoDumpStack(app, 'AutoDump', {
        env: { account: process.env.account, region: process.env.region},
    })
} else if  (app.account === AwsAccount.VoDev && app.region === AwsRegion.Oregon) {
    new AutoDumpStack(app, 'AutoDump', {
        env: { account: '062758075735', region: 'us-west-2' },
    })
} else if  (app.account === AwsAccount.SupplyChainDev && app.region === AwsRegion.Oregon) {
    new AutoDumpStack(app, 'AutoDump', {
        env: { account: process.env.account, region: process.env.region},
        // env: { account: '250585841971', region: 'us-west-2' },
    })
}
else {
    console.log("Nada" + app.account)
};

