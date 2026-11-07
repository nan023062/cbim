/**
 * 作用定位：主运行负责人四工具的严格输入、业务输出和可信端口协议。
 * 设计原因：模型只提交责任选择与预览依据；命令、运行身份和权限由闭包注入，唯一输出快照核验后才交付。
 * 边界：查询覆盖工作区责任控制面，不代表派发或验收；回执不存在保持 unknown，不授权重新写入。
 */
import {z} from 'zod';
import {moduleOwnershipChangeInputSchema,moduleOwnershipCursorSchema,moduleOwnershipPageSchema,moduleOwnershipPreviewSchema,moduleOwnershipReadBasisSchema,moduleOwnershipReceiptSchema} from './module-ownership';
import {workspaceMemberListSchema,workspaceRegistryCursorSchema} from '../team/workspace-member';

const id=z.string().min(1).max(1024),uuid=z.string().uuid(),sha=z.string().regex(/^[a-f0-9]{64}$/);
const modules=z.object({moduleIds:z.array(id).min(1).max(20).refine(ids=>new Set(ids).size===ids.length)}).strict();
const byMember=z.object({memberId:uuid,offset:z.number().int().nonnegative().safe().optional(),limit:z.number().int().min(1).max(20).optional(),expectedReadBasis:moduleOwnershipReadBasisSchema.optional()}).strict().refine(value=>!value.offset||!!value.expectedReadBasis,'后续页必须固定查询依据');
const members=z.object({members:z.literal(true),offset:z.number().int().nonnegative().safe().optional(),limit:z.number().int().min(1).max(20).optional(),expectedRegistryCursor:workspaceRegistryCursorSchema.optional()}).strict().refine(value=>!value.offset||!!value.expectedRegistryCursor,'后续页必须固定岗位游标');
export const moduleOwnerInspectInputSchema=z.union([modules,byMember,members]);
export const moduleOwnerPreviewInputSchema=z.object({change:moduleOwnershipChangeInputSchema}).strict();
export const moduleOwnerCommitInputSchema=z.object({change:moduleOwnershipChangeInputSchema,expectedOwnershipCursor:moduleOwnershipCursorSchema.nullable(),expectedBasis:sha}).strict();
export const moduleOwnerReceiptInputSchema=z.object({commandId:uuid}).strict();
export type ModuleOwnerInspectInput=z.infer<typeof moduleOwnerInspectInputSchema>;
export type ModuleOwnerPreviewInput=z.infer<typeof moduleOwnerPreviewInputSchema>;
export type ModuleOwnerCommitInput=z.infer<typeof moduleOwnerCommitInputSchema>;
export type ModuleOwnerReceiptInput=z.infer<typeof moduleOwnerReceiptInputSchema>;
export const moduleOwnerIdentitySchema=z.object({workspaceId:z.string().min(1).max(512),rootSessionId:id}).strict();
export const moduleOwnerInspectOutputSchema=z.union([
  z.object({identity:moduleOwnerIdentitySchema,readOnly:z.literal(true),selection:z.union([modules,byMember]),page:moduleOwnershipPageSchema}).strict(),
  z.object({identity:moduleOwnerIdentitySchema,readOnly:z.literal(true),selection:members,memberPage:workspaceMemberListSchema}).strict(),
]);
export const moduleOwnerPreviewOutputSchema=z.object({identity:moduleOwnerIdentitySchema,preview:moduleOwnershipPreviewSchema}).strict();
export const moduleOwnerRecordedOutputSchema=z.object({identity:moduleOwnerIdentitySchema,status:z.literal('recorded'),commandId:uuid,receipt:moduleOwnershipReceiptSchema}).strict();
export const moduleOwnerReceiptOutputSchema=z.union([moduleOwnerRecordedOutputSchema,z.object({identity:moduleOwnerIdentitySchema,status:z.literal('unknown'),commandId:uuid}).strict()]);
export const moduleOwnerToolOutputLimit=128*1024;

/** per-run 可信绑定不属于模型参数；原 call ID 经 Pi 的一次性 gate 单独传入。 */
export interface ModuleOwnerRunBinding {workspaceId:string;instanceId:string;rootSessionId:string;scopeId:string;agentInstanceId:string;agentSessionId:string;runId:string}
/** 领域方法只执行一次；运行关闭与 Store 生命周期由 Main 实现核实。 */
export interface ModuleOwnershipToolsPort {
  inspect(input:ModuleOwnerInspectInput,signal:AbortSignal):Promise<unknown>;
  preview(input:ModuleOwnerPreviewInput,signal:AbortSignal):Promise<unknown>;
  commit(input:ModuleOwnerCommitInput,toolCallId:string,signal:AbortSignal):Promise<unknown>;
  receipt(input:ModuleOwnerReceiptInput,signal:AbortSignal):Promise<unknown>;
}
