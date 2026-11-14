/**
 * 作用定位：工作区自动化的定义、计划、持久启动记录及端口契约。
 * 设计原因：计划与一次执行分开保存；调度只依赖存储/执行端口，不认识桌面、模型供应商或具体文件。执行结束不代表业务验收。
 */
import {z} from 'zod';
const id=z.string().min(1).max(1024),uuid=z.string().uuid(),time=z.string().datetime(),revision=z.number().int().positive().safe();
export const automationScheduleSchema=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('manual')}).strict(),
 z.object({kind:z.literal('interval'),minutes:z.number().int().min(1).max(525600)}).strict(),
 z.object({kind:z.literal('daily'),time:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),timezone:z.string().min(1).max(100).refine(value=>{try{new Intl.DateTimeFormat('en',{timeZone:value});return true}catch{return false}},'时区无效')}).strict(),
 z.object({kind:z.literal('once'),at:time}).strict(),
]);
export const automationDefinitionSchema=z.object({name:z.string().trim().min(1).max(120),enabled:z.boolean(),executor:z.discriminatedUnion('kind',[z.object({kind:z.literal('main')}).strict(),z.object({kind:z.literal('member'),memberId:uuid}).strict()]),moduleIds:z.array(id).max(20),workflowSelections:z.array(z.object({moduleId:id,workflowId:id}).strict()).max(20),skillIds:z.array(id).max(30),prompt:z.string().trim().min(1).max(16000),permission:z.enum(['read','ask','execute']),schedule:automationScheduleSchema}).strict().superRefine((value,ctx)=>{
 if(new Set(value.moduleIds).size!==value.moduleIds.length||new Set(value.skillIds).size!==value.skillIds.length||new Set(value.workflowSelections.map(item=>item.moduleId)).size!==value.workflowSelections.length||value.workflowSelections.some(item=>!value.moduleIds.includes(item.moduleId))||value.executor.kind==='member'&&!value.moduleIds.length)ctx.addIssue({code:'custom',message:'模块/Skill 不得重复，每个 Workflow 必须属于所选模块；岗位执行须明确模块'});
});
export type AutomationDefinition=z.infer<typeof automationDefinitionSchema>;
export type AutomationSchedule=z.infer<typeof automationScheduleSchema>;
export const automationJobSchema=z.object({id:uuid,workspaceId:id,revision,definition:automationDefinitionSchema,createdAt:time,updatedAt:time,nextRunAt:time.optional()}).strict();
export type AutomationJob=z.infer<typeof automationJobSchema>;
export const automationRunStatusSchema=z.enum(['starting','running','waiting','completed','failed','cancelled','interrupted','unknown','skipped']);
export type AutomationRunStatus=z.infer<typeof automationRunStatusSchema>;
export const automationRunSchema=z.object({id:uuid,automationId:uuid,definitionRevision:revision,definition:automationDefinitionSchema,trigger:z.enum(['schedule','manual']),startedAt:time,finishedAt:time.optional(),status:automationRunStatusSchema,taskId:id.optional(),runId:id.optional(),message:z.string().max(4000).optional()}).strict();
export type AutomationRun=z.infer<typeof automationRunSchema>;
export const automationStateSchema=z.object({version:z.literal(1),workspaceId:id,jobs:z.array(automationJobSchema).max(100),runs:z.array(automationRunSchema).max(500)}).strict().superRefine((value,ctx)=>{if(value.jobs.some(job=>job.workspaceId!==value.workspaceId)||new Set(value.jobs.map(job=>job.id)).size!==value.jobs.length||new Set(value.runs.map(run=>run.id)).size!==value.runs.length)ctx.addIssue({code:'custom',message:'自动化身份或重复记录无效'})});
export type AutomationState=z.infer<typeof automationStateSchema>;
export const automationIdentitySchema=z.object({workspaceId:id,instanceId:uuid}).strict();
export const automationSaveSchema=automationIdentitySchema.extend({id:uuid.optional(),expectedRevision:z.number().int().nonnegative().safe(),definition:automationDefinitionSchema}).strict();
export const automationCommandSchema=automationIdentitySchema.extend({id:uuid,expectedRevision:revision}).strict();
export const automationToggleSchema=automationCommandSchema.extend({enabled:z.boolean()}).strict();
export type AutomationSave=z.infer<typeof automationSaveSchema>;
/** 唯一调度所有者串行使用；保存成功后才允许发出外部执行。 */
export interface AutomationStorage {read():Promise<AutomationState>;write(state:AutomationState):Promise<void>}
/** bind 必须先于模型启动完成，用于持久记录真实主任务身份；未知结果不能自行重试。 */
export interface AutomationRunner {
 validate(definition:AutomationDefinition):Promise<void>;
 start(run:AutomationRun,signal:AbortSignal,bind:(identity:{taskId:string;runId:string})=>Promise<void>):Promise<{taskId:string;runId:string}>;
 inspect(taskId:string):Promise<{status:Exclude<AutomationRunStatus,'starting'|'skipped'>;message?:string}>;
 stop(taskId:string):Promise<void>;
}
export interface AutomationCatalog {workspaceId:string;agents:{memberId:string;agentId:string;name:string}[];modules:{id:string;name:string;workflows:{id:string;name:string}[]}[];skills:{id:string;name:string;agentIds:string[]}[]}
