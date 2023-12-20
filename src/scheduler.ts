import * as arnparser from "@aws-sdk/util-arn-parser"
import * as cron from "cron-parser";
import {CronExpression} from "cron-parser/types"
import {SFNClient, StartExecutionCommand} from "@aws-sdk/client-sfn"
import {DateTime} from "luxon"
import {
    DescribeDBClustersCommand,
    DescribeDBInstancesCommand,
    DescribeEventsCommand,
    RDSClient, SourceType,
    Tag as RdsTag
} from "@aws-sdk/client-rds"


const rdsClient = new RDSClient({});
const sfnClient = new SFNClient({});

type ResourceType = "rds-instance" | "rds-cluster" ;
type Action = "dump";
// type State = "stopped" | "running" | "terminated" | "other";

interface AutoDumpTags {
    readonly timezone?: string;
    readonly dumpSchedule?: string;
    readonly databaseName?: string;
    readonly retentionDays?: string;
}

export function cyrb53(str: string, seed: number = 0): number {
    let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
    for (let i = 0, ch; i < str.length; i++) {
        ch = str.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
    h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
    h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);

    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

function hashTagsV1(tags: AutoDumpTags): string {
    return "V1" + cyrb53(`${tags.timezone ?? ""}|${tags.dumpSchedule ?? ""}|` +
        `${tags.databaseName ?? ""}|${tags.retentionDays ?? ""}|`);
}

interface AutoDumpResource {
    readonly type: ResourceType;
    readonly id: string,
    readonly tags: AutoDumpTags,
    readonly tagsHash: string,
    readonly dumpSchedule: string
}

interface AutoDumpRdsClusterInstance {
    readonly id: string,
}

interface AutoDumpRdsClusterResource extends AutoDumpResource {
    readonly instanceIds: AutoDumpRdsClusterInstance[]
}

interface AutoDumpAction {
    readonly resourceType: ResourceType;
    readonly resourceId: string;
    readonly tagHash: string;
    readonly when: string;
    readonly action: Action;
}

interface AutoDumpActionResult extends AutoDumpAction {
    readonly execute: boolean;
    readonly reason: string;
    readonly resource?: AutoDumpResource;
}

function getActionName(action: AutoDumpAction, tags: AutoDumpTags, hashId?: boolean): string {
    console.log(`\n\ngetActionName: ${action.resourceId} ${action.action} ${action.resourceType} `)
    const id = hashId ? cyrb53(action.resourceId) : action.resourceId;
    return `${action.resourceType}-${id}-${action.action}-` +
        `${DateTime.fromISO(action.when).toFormat("yyyy-MM-dd-HH-mm")}-${hashTagsV1(tags)}`.slice(0, 80);
}

function optionalNumber(value: string | undefined): number | undefined {
    return value ? Number(value) : undefined;
}

function optionalCron(value: string | undefined, tz: string): CronExpression | undefined {
    if (value) {
        const parts = value.split(/\s+/);
        if (parts.length !== 5) {
            throw new Error(`Invalid cron expression: ${value}. Expecting 5 fields and received ${parts.length}}`);
        }
        if (parts[0].trim() === "*" || parts[0].trim() === "-") {
            throw new Error("Invalid cron expression. The use * or - in the minute field is not allowed.");
        }
        const cleaned = value.trim().replaceAll(" -", " *").replaceAll(":", ",");
        return cron.parseExpression(cleaned, {
            tz,
            currentDate: new Date(Date.now() + 60000), // look 1 minute in the future to be safe
        })
    }
    return undefined;
}

function cronAction(resource: AutoDumpResource, action: Action, cronExpression: string): AutoDumpAction | undefined {
    const tz = resource.tags.timezone ?? "UTC";
    const expression = optionalCron(cronExpression, tz);
    if (expression && expression.hasNext()) {
        return {
            resourceType: resource.type,
            resourceId: resource.id,
            when: expression.next().toISOString(),
            action,
            tagHash: hashTagsV1(resource.tags),
        };
    } else {
        return {
            resourceType: resource.type,
            resourceId: resource.id,
            when: "",
            tagHash: hashTagsV1(resource.tags),
        };
    };
}

function cronActions(resource: AutoDumpResource): AutoDumpAction[] {
    const actions: AutoDumpAction[] = [];
    console.log(`\n\ncronActions: dump schedule is ${resource.tags.dumpSchedule}. If it is undefined, check the tags.\n`)
    if (resource.tags.dumpSchedule) {
        const dump = cronAction(resource, "dump", resource.tags.dumpSchedule);
        console.log(`\n\ncronActions  ${resource.tags.dumpSchedule} `)

        if (dump) {
            actions.push(dump);
        }
    }

    // console.log(`\n\ncronActions: stop schedule is ${resource.tags.stopSchedule}. If it is undefined, check the tags.`)
    // if (resource.tags.stopSchedule) {
    //     const stop = cronAction(resource, "stop", resource.tags.stopSchedule);
    //     console.log(`\n\ncronActions ${stop.action} ${stop.resourceType} ${stop.resourceId} at ${stop.when}`)
    //
    //     if (stop) {
    //         actions.push(stop);
    //     }
    // }
    // // ECS services don't support reboot
    // if (resource.type !== "ecs-service" && resource.tags.rebootSchedule) {
    //     const reboot = cronAction(resource, "reboot", resource.tags.rebootSchedule);
    //     console.log(`\n\ncronActions reboot ${reboot}`)
    //
    //     if (reboot) {
    //         actions.push(reboot);
    //     }
    // }
    return actions;
}

function nextAction(resource: AutoDumpResource, priorAction?: AutoDumpAction): AutoDumpAction | undefined {
    console.log(`\n\nnextAction: ${priorAction}\n`)
    let selected = undefined;
    const actions = [...cronActions(resource)];
    console.log(`\n\nEvaluating ${actions.length} possible future actions for ${resource.type} ${resource.id}`);
    for (const action of actions) {
        if (selected === undefined || action.when < selected.when) {
            selected = action;
        }
    }
    return selected;
}

function calculateWhen(time: string, minutes: number): Date {
    const when = new Date(time).getTime() + (minutes * 60000);
    return when < Date.now()
        ? new Date(new Date().setMilliseconds(0) + 60000) // clears out milliseconds and adds 1 minute
        : new Date(when);
}

function toCamelCase(str: string): string {
    str = (str.match(/[a-zA-Z0-9]+/g) || []).map(x => `${x.charAt(0).toUpperCase()}${x.slice(1)}`).join("");
    return str.charAt(0).toLowerCase() + str.slice(1);
}


async function startExecution(stateMachineArn: string, resource: AutoDumpResource, action?: AutoDumpAction): Promise<void> {
    console.log(`\n\nstartExecution: ${resource.id} \n`) //${action.action}\n`)
    if (action) {
        const input = JSON.stringify(action);
        console.log(`\n\nScheduling ${action.resourceType} ${action.resourceId} to ${action.action} at ${action.when}. Execution Input is ${input}\n`);
        // console.log("Execution Input: " + input);
        await sfnClient.send(new StartExecutionCommand({
            stateMachineArn,
            input,
            name: getActionName(action, resource.tags, resource.type === "rds-instance")
        }));
    }
}

export async function processStateAction(stateMachineArn: string, action: AutoDumpAction): Promise<AutoDumpActionResult | undefined> {
    console.log(`\n\nprocessStateAction: Processing ${action.action} of ${action.resourceType} ${action.resourceId} at ${action.when}\n`);
    let resources = [];
    if (action.resourceType === "rds-instance") {
        resources = await describeRdsInstances(action.resourceId);
    }
    if (action.resourceType === "rds-cluster") {
        resources = await describeRdsClusters(action.resourceId);
    }
    if (resources.length === 0) {
        return {...action, execute: false, reason: "Instance no longer exists"};
    }
    const resource = resources[0];
    const tagsHash = hashTagsV1(resource.tags);
    if (tagsHash !== action.tagHash) {
        console.log(`\n\n${action.resourceType} ${action.resourceId} tags do not match execution, doing nothing...`);
        return {
            ...action,
            execute: false,
            reason: "Tags do not match execution",
            resource
        };
    }
    if (action.action === "dump") {
        await startExecution(stateMachineArn, resource, nextAction(resource, action));
        if (resource.state === "stopped") {
            console.log(`\n\n${action.resourceType} ${action.resourceId} is stopped, starting...`);
            return {
                ...action,
                execute: true,
                reason: "Checks passed",
                resource
            };
        } else {
            console.log(`\n\n${action.resourceType} ${action.resourceId} is not stopped, doing nothing...`);
            return {
                ...action,
                execute: false,
                reason: "Instance is not stopped",
                resource
            };
        }
    }

}

function rdsTags(tags?: RdsTag[]): AutoDumpTags {
    if (!tags) {
        return {};
    }
    const autoDumpTags = tags.reduce((tags, tag) => {
        if (tag.Key === "autodump:dump-schedule"
            || tag.Key === "autodump:database-name"
            || tag.Key === "autodump:retention-days") {
            tags[toCamelCase(tag.Key.replace("autodump:", ""))] = tag.Value.trim();
        }
        return tags;
    }, {} as AutoDumpTags) ?? {};
}

async function describeRdsInstances(instanceId: string): Promise<AutoDumpRdsInstanceResource[]> {
    const resources: AutoDumpResource[] = [];
    try {
        const output = await rdsClient.send(new DescribeDBInstancesCommand({
            DBInstanceIdentifier: instanceId
        }));
        for (const instance of output.DBInstances ) {
            const tags = rdsTags(instance.TagList);
            const tagsHash = hashTagsV1(tags);
            resources.push({
                type: "rds-instance",
                id: instanceId,
                // createTime: instance.InstanceCreateTime?.toISOString() ?? new Date().toISOString(),
                // startTime,
                // state,
                instanceId,
                tags,
                tagsHash
            })
        }
    } catch (e) {
        if (e.errorType !== "DBInstanceNotFoundFault") {
            return resources;
        } else {
            throw e;
        }
    }
    return resources;
}


async function describeRdsClusters(clusterId: string): Promise<AutoDumpRdsClusterResource[]> {
    const resources: AutoDumpRdsClusterResource[] = [];
    try {
        const output = await rdsClient.send(new DescribeDBClustersCommand({
            DBClusterIdentifier: clusterId
        }));
        for (const cluster of output.DBClusters  ) {
            // const startTime = await getRdsStartTime(SourceType.db_cluster, clusterId).then(date => date.toISOString());
            console.log(cluster.DBClusterMembers?.map(member => {return {id: member.DBInstanceIdentifier }}))
            const instanceIds: AutoDumpRdsClusterInstance[] = cluster.DBClusterMembers?.map(member => {return {id: member.DBInstanceIdentifier }}) ?? [];
            const dumpSchedule :string = "0 8 * * *"
            const tags = rdsTags(cluster.TagList);
            const tagsHash = hashTagsV1(tags);
            resources.push({
                type: "rds-cluster",
                id: clusterId,
                // createTime: cluster.ClusterCreateTime?.toISOString() ?? new Date().toISOString(),
                // startTime: startTime,
                dumpSchedule,
                instanceIds,
                tags,
                tagsHash
            })
        }
    } catch (error) {
        if (error.errorType !== "DBClusterNotFoundFault") {
            return resources;
        } else {
            throw error;
        }
    }
    return resources;
}


export async function handleCloudWatchEvent(stateMachineArn: string, event: any): Promise<void> {
    console.log(`\n\nProcessing CloudWatch event ${event.id}. event detail type is ${event["detail-type"]}`);
    let resources: AutoDumpResource[] = [];
    if (event["detail-type"] === "Tag Change on Resource") {
        console.log(`\n\nhandleCloudWatchEvent: ${event["detail-type"]} \n `)
        // resources.push(...await describeEc2Instances(
        //     event.resources.map(arn => arnparser.parse(arn).resource.replace("instance/", ""))));
        console.log(`\n\nresource.push done: ${resources.length} ${resources}\n `)

    }
}


export async function handler(event: any): Promise<any> {
    const stateMachineArn = event.StateMachine.Id;
    const input = event.Execution.Input;
    console.log(`\n\nhandler: state machine arn is ${stateMachineArn}, input is ${input}\n`);
    if (input.detail) {
        console.log(`\n\nhandler for ${stateMachineArn}, scheduling tag change with handleCloudWatchEvent`)
        return handleCloudWatchEvent(stateMachineArn, input);
    } else {
        const action = input as AutoDumpAction;
        if (action.resourceType === "rds-instance"
            || action.resourceType === "rds-cluster") {
            return processStateAction(stateMachineArn, action);
        } else {
            throw new Error(`Unsupported resource type ${action.resourceType}`);
        }
    }
}
