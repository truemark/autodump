import { Construct } from 'constructs';
import {AutoDump} from "./autodump-construct";
import * as p from "../package.json";
import {ExtendedStack, ExtendedStackProps} from "truemark-cdk-lib/aws-cdk";


export interface AutoDumpStackProps extends ExtendedStackProps {
  readonly vpcId: string;
  readonly privateSubnetIds: string[];
  readonly availabilityZones: string[];
}

export class AutoDumpStack extends ExtendedStack {
    constructor(scope: Construct, id: string, props: AutoDumpStackProps) {
        super(scope, id, props);
        this.addMetadata("Version", p.version);
        this.addMetadata("Name", p.name);
        this.addMetadata("RepositoryType", p.repository.type);
        this.addMetadata("Repository", p.repository.url);
        this.addMetadata("Homepage", p.homepage);

        new AutoDump(this, "AutoDump", {
          ...props,
        });
    }
}
