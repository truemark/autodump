import {NodejsFunction} from 'aws-cdk-lib/aws-lambda-nodejs';
import {Construct} from 'constructs';
import {Architecture, Runtime} from 'aws-cdk-lib/aws-lambda';
import {Duration} from 'aws-cdk-lib';
import {RetentionDays} from 'aws-cdk-lib/aws-logs';
import * as path from 'path';
import {PolicyStatement} from 'aws-cdk-lib/aws-iam';

interface ScannerFunctionProps {
  readonly tagName: string;
}

export class ScannerFunction extends NodejsFunction {
  constructor(scope: Construct, id: string, props: ScannerFunctionProps) {
    super(scope, id, {
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      memorySize: 512,
      timeout: Duration.seconds(900), // TODO This seems short for accounts that may have many secrets.
      logRetention: RetentionDays.ONE_MONTH,
      entry: path.join(__dirname, '..', '..', 'handlers', 'src', 'scanner.mts'),
      handler: 'handler',
      environment: {
        TAG_NAME: props.tagName,
      },
    });

    this.addToRolePolicy(
      new PolicyStatement({
        actions: ['states:StartExecution'],
        resources: ['*'],
      }),
    );

    this.addToRolePolicy(
      new PolicyStatement({
        actions: [
          'secretsmanager:GetSecretValue',
          'secretsmanager:DescribeSecret',
          'secretsmanager:ListSecrets',
          'kms:decrypt',
        ],
        // TODO: Narrow  down to autodump secrets, by tag or prefix, and the KMS key used to encrypt them.
        resources: ['*'],
      }),
    );
  }
}
