import {Construct} from 'constructs';
import {AutoDump} from './autodump-construct';
import * as p from '../package.json';
import {ExtendedStack, ExtendedStackProps} from 'truemark-cdk-lib/aws-cdk';

/**
 * Properties for the AutoDumpStack.
 */
export interface AutoDumpStackProps extends ExtendedStackProps {
  /**
   * The VPC ID to run AutoDump in.
   */
  readonly vpcId: string;
  /**
   * The private subnets to run AutoDump in.
   */
  readonly privateSubnetIds: string[];
  /**
   * The availability zones to run AutoDump in.
   */
  readonly availabilityZones: string[];
  /**
   * The bucket name to use. If one is not provided, a generated name is used.
   */
  readonly bucketName?: string;
  /**
   * Set to true to create a read-only IAM user. Default is false. No secret key is generated.
   */
  readonly createReadOnlyUser?: boolean;
}

/**
 * Primary stack for AutoDump delegating to the AutoDump construct.
 */
export class AutoDumpStack extends ExtendedStack {
  constructor(scope: Construct, id: string, props: AutoDumpStackProps) {
    super(scope, id, props);
    // TODO Need to standardize how we do these and they should likely be output variables instead of metadata that can't change.
    this.addMetadata('Version', p.version);
    this.addMetadata('Name', p.name);
    this.addMetadata('RepositoryType', p.repository.type);
    this.addMetadata('Repository', p.repository.url);
    this.addMetadata('Homepage', p.homepage);

    new AutoDump(this, 'AutoDump', {
      ...props,
    });
  }
}
