import {NodejsFunction} from "aws-cdk-lib/aws-lambda-nodejs"
import {Construct} from "constructs"
import {Architecture, Runtime, Code} from "aws-cdk-lib/aws-lambda"
import {Duration} from "aws-cdk-lib"
import {RetentionDays} from "aws-cdk-lib/aws-logs"
import * as path from "path";
import {PolicyStatement} from "aws-cdk-lib/aws-iam"

interface HashFunctionProps {
    readonly secretArn: string;
    readonly initialHash: string;
}

export class HashFunction extends NodejsFunction {
    constructor(scope: Construct, id: string, props: HashFunctionProps) {
        super(scope, id, {
            runtime: Runtime.NODEJS_20_X,
            architecture: Architecture.ARM_64,
            memorySize: 512,
            timeout: Duration.seconds(40),
            logRetention: RetentionDays.ONE_MONTH,
            entry: path.join(__dirname, "..", "handlers", "src", "hash.ts"),
            handler: "handler",
            // environment: {
            //     TAG_NAME: props.tagName
            // },
        });


      this.addToRolePolicy(new PolicyStatement({
        actions: [
          'secretsmanager:GetSecretValue',
          "secretsmanager:DescribeSecret",
          "secretsmanager:ListSecrets"
        ],
        resources: ['*'],
      }));
    }
}
