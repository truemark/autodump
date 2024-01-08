import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import {AutoDump} from "./autodump-construct";
import * as p from "../package.json";
import {AwsAccount, AwsRegion} from "./enums";

export class AutoDumpStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);
        this.addMetadata("Version", p.version);
        this.addMetadata("Name", p.name);
        this.addMetadata("RepositoryType", p.repository.type);
        this.addMetadata("Repository", p.repository.url);
        this.addMetadata("Homepage", p.homepage);

//
//
//         if (app.account === AwsAccount.LkSandbox && app.region === AwsRegion.Oregon) {
//             console.log("deploying---------->" + app.account)
// // Is it possible to reference a variable in the env statement?
//             new AutoDumpStack(app, 'AutoDump', {
//                 env: { account: process.env.account, region: process.env.region},
//             })
//         } else if  (app.account === AwsAccount.VoDev && app.region === AwsRegion.Oregon) {
//             new AutoDumpStack(app, 'AutoDump', {
//                 env: { account: '062758075735', region: 'us-west-2' },
//             })
//         } else if  (app.account === AwsAccount.SupplyChainDev && app.region === AwsRegion.Oregon) {
//             new AutoDumpStack(app, 'AutoDump', {
//                 env: { account: process.env.account, region: process.env.region},
//                 // env: { account: '250585841971', region: 'us-west-2' },
//             })
//         }
//         else {
//             console.log("Nada" + app.account)
//         };

        // new AutoDump(this, "AutoDump", {});
    }
}
