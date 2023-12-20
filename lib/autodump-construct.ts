import {Construct} from "constructs"
import {Duration, RemovalPolicy} from "aws-cdk-lib"
import {IEventBus, Rule} from "aws-cdk-lib/aws-events"
import {Queue, QueueEncryption} from "aws-cdk-lib/aws-sqs"
import {SchedulerFunction} from "./scheduler-function"
import * as Logs from "aws-cdk-lib/aws-logs"
import * as Iam from "aws-cdk-lib/aws-iam"
import {
    Choice,
    Condition, Fail,
    JsonPath,
    LogLevel,
    Pass,
    StateMachine,
    StateMachineType,
    Wait,
    WaitTime,
    Map as SfnMap
} from "aws-cdk-lib/aws-stepfunctions"
import {CallAwsService, LambdaInvoke} from "aws-cdk-lib/aws-stepfunctions-tasks"
import {SfnStateMachine} from "aws-cdk-lib/aws-events-targets"

export interface AutoStateProps {
    readonly tagPrefix?: string;
    readonly eventBus?: IEventBus;
}
export class AutoDump extends Construct {
    constructor(scope: Construct, id: string, props: AutoStateProps) {
        super(scope, id);

        const tagPrefix = props.tagPrefix ?? "autodump:";

        const schedulerFunction = new SchedulerFunction(this, "SchedulerFunction", {tagPrefix});

        const addExecutionContext = new Pass(this, "AddExecutionContext", {
            parameters: {
                "Execution.$": "$$.Execution",
                "State.$": "$$.State",
                "StateMachine.$": "$$.StateMachine",
            }
        });

        const wait = new Wait(this, "WaitForAction", {
            time: WaitTime.timestampPath(JsonPath.stringAt("$.Execution.Input.when"))});


        const doNothing = new Pass(this, "DoNothing");

        const routeAction = new Choice(this, "ActionRouter")
            .when(Condition.isNotPresent("$.execute"), doNothing)
            .otherwise(doNothing);

        const invokeScheduler = new LambdaInvoke(this, "Scheduler", {
            lambdaFunction: schedulerFunction,
            outputPath: "$.Payload",
        });

        const eventProcessor = new LambdaInvoke(this, "EventProcessor", {
            lambdaFunction: schedulerFunction,
        });

        const eventRouter = new Choice(this, "EventRouter");
        eventRouter.when(Condition.isPresent("$.Execution.Input.when"), wait.next(invokeScheduler).next(routeAction));
        eventRouter.when(Condition.stringEquals("$.Execution.Input.detail-type", "Tag Change on Resource"), eventProcessor);
        eventRouter.when(Condition.stringEquals("$.Execution.Input.detail-type", "EC2 Instance State-change Notification"), eventProcessor);
        eventRouter.when(Condition.stringEquals("$.Execution.Input.detail-type", "RDS DB Instance Event"), eventProcessor);
        eventRouter.when(Condition.stringEquals("$.Execution.Input.detail-type", "RDS DB Cluster Event"), eventProcessor);
        eventRouter.when(Condition.and(
            Condition.stringEquals("$.Execution.Input.detail-type", "AWS API Call via CloudTrail"),
            Condition.stringEquals("$.Execution.Input.source", "aws.ecs"),
        ), eventProcessor);
        eventRouter.otherwise(new Fail(this, "UnknownEvent", {
            cause: "Unknown event type",
        }));

        //  This is where the state machine will write logs.
        const logGroup = new Logs.LogGroup(this, "/autodump-execution-logs/", {});

        const stateMachine = new StateMachine(this, "Default", {
            definition: addExecutionContext.next(eventRouter),
            stateMachineType: StateMachineType.STANDARD,
            removalPolicy: RemovalPolicy.DESTROY,
            logs: {
                destination: logGroup,
                level: LogLevel.ALL,
            },
        });

        // Grant the state machine role the ability to create and deliver to a log stream.
        stateMachine.addToRolePolicy(
            new Iam.PolicyStatement({
                actions: [
                    "logs:CreateLogDelivery",
                    "logs:CreateLogStream",
                    "logs:GetLogDelivery",
                    "logs:UpdateLogDelivery",
                    "logs:DeleteLogDelivery",
                    "logs:ListLogDeliveries",
                    "logs:PutLogEvents",
                    "logs:PutResourcePolicy",
                    "logs:DescribeResourcePolicies",
                    "logs:DescribeLogGroups"
                ],
                resources: ['*'],
            })
        );

        const tagRule = new Rule(this, "TagRule", {
            eventPattern: {
                source: ["aws.tag"],
                detailType: ["Tag Change on Resource"],
                detail: {
                    service: ["ec2", "rds", "ecs"],
                    "resource-type": ["service", "cluster", "instance", "db"],
                    "changed-tag-keys": [
                        "autodump:dump-schedule",
                        "autodump:database-name",
                        "autodump:retention-days",
                    ],
                }
            },
            description: "Routes tag events AutoDump Step Function"
        });

        // const ec2StartRule = new Rule(this, "Ec2StartRule", {
        //     eventPattern: {
        //         source: ["aws.ec2"],
        //         detailType: ["EC2 Instance State-change Notification"],
        //         detail: {
        //             state: ["running"],
        //         }
        //     },
        //     description: "Routes EC2 start events to AutoState Step Function",
        //     eventBus: props.eventBus
        // });
        //
        // const rdsStartRule = new Rule(this, "RdsStartRule", {
        //     eventPattern: {
        //         source: ["aws.rds"],
        //         detailType: ["RDS DB Instance Event", "RDS DB Cluster Event"],
        //         detail: {
        //             SourceType: ["DB_INSTANCE", "CLUSTER"],
        //             Message: ["DB instance started", "DB cluster started"]
        //         }
        //     },
        //     description: "Routes RDS start events to AutoState Step Function",
        //     eventBus: props.eventBus
        // });
        //
        // const ecsStartRule = new Rule(this, "EcsStartRule", {
        //     eventPattern: {
        //         source: ["aws.ecs"],
        //         detailType: ["AWS API Call via CloudTrail"],
        //         detail: {
        //             "eventSource": ["ecs.amazonaws.com"],
        //             "eventName": ["UpdateService"],
        //             "requestParameters": {
        //                 "desiredCount": [ { "numeric": [ ">", 0 ] } ]
        //             }
        //         }
        //     }
        // });
    }
}
