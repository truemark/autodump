import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import {AutoDump} from "./autodump-construct";
import * as p from "../package.json";
import {AwsAccount, AwsRegion} from "./enums";
import {ExtendedStack, ExtendedStackProps} from "truemark-cdk-lib/aws-cdk";

export class AutoDumpStack extends ExtendedStack {
    constructor(scope: Construct, id: string, props?: ExtendedStackProps) {
        super(scope, id, props);
        this.addMetadata("Version", p.version);
        this.addMetadata("Name", p.name);
        this.addMetadata("RepositoryType", p.repository.type);
        this.addMetadata("Repository", p.repository.url);
        this.addMetadata("Homepage", p.homepage);

        new AutoDump(this, "AutoDump", {});
    }
}
