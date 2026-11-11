/**
 * 作用定位：主 Agent 岗位治理的窄输入、回执和装配端口，独立于 UI 与存储。
 * 设计原因：复用岗位事务但不开放模型选型；登记只能继承静态 Agent 的既有配置，能力采纳与来源采纳分别表达。
 */
import {z} from 'zod';
import {workspaceMemberChangeInputSchema,workspaceMemberCurrentDiffSchema,workspaceMemberIdentitySchema,workspaceMemberListSchema,workspaceMemberReceiptSchema,workspaceMemberStateSchema,workspaceRegistryCursorSchema} from './workspace-member';
const uuid=z.string().uuid(),hash=z.string().regex(/^[a-f0-9]{64}$/);
const [register,update,adopt,state]=workspaceMemberChangeInputSchema.options;
/** 主工具不接收模型、凭据、actor 或命令身份；公开模型变更仍由桌面明确提交。 */
export const memberToolChangeSchema=z.union([
  register.omit({runtimePolicy:true}),
  update.extend({patch:z.object({name:z.string().min(1).max(100).optional(),position:z.string().min(1).max(500).optional(),adaptation:register.shape.adaptation.optional()}).strict().refine(p=>Object.keys(p).length>0)}),
  adopt.extend({target:z.literal('capability')}),state,
]);
export const memberToolInspectSchema=z.union([z.object({memberId:uuid}).strict(),z.object({offset:z.number().int().min(0).optional(),limit:z.number().int().min(1).max(20).optional(),expectedRegistryCursor:workspaceRegistryCursorSchema.optional()}).strict().refine(v=>!v.offset||!!v.expectedRegistryCursor)]);
export const memberToolPreviewSchema=z.object({change:memberToolChangeSchema}).strict();
export const memberToolCommitSchema=memberToolPreviewSchema.extend({expectedRegistryCursor:workspaceRegistryCursorSchema.nullable(),expectedBasis:hash}).strict();
export const memberToolReceiptSchema=z.object({commandId:uuid}).strict();
const identity=workspaceMemberIdentitySchema;
const detail=z.object({memberId:uuid,revision:z.number().int().positive(),agentId:z.string(),state:workspaceMemberStateSchema,currentDiff:workspaceMemberCurrentDiffSchema,repair:z.array(z.string()).max(4)}).strict();
export const memberToolInspectOutput=z.union([z.object({identity,detail}).strict(),z.object({identity,page:workspaceMemberListSchema}).strict()]);
export const memberToolPreviewOutput=z.object({identity,change:memberToolChangeSchema,basis:hash,registryCursor:workspaceRegistryCursorSchema.nullable(),previousRevision:z.number().int().min(0),capabilityHash:hash,configurationHash:hash,changedFields:z.array(z.string()).max(6)}).strict();
export const memberToolReceiptOutput=z.union([z.object({identity,status:z.literal('recorded'),commandId:uuid,receipt:workspaceMemberReceiptSchema}).strict(),z.object({identity,status:z.literal('unknown'),commandId:uuid}).strict()]);
export const memberToolInputs={cbim_member_inspect:memberToolInspectSchema,cbim_member_change_preview:memberToolPreviewSchema,cbim_member_change_commit:memberToolCommitSchema,cbim_member_receipt:memberToolReceiptSchema};
export const memberToolOutputs={cbim_member_inspect:memberToolInspectOutput,cbim_member_change_preview:memberToolPreviewOutput,cbim_member_change_commit:memberToolReceiptOutput,cbim_member_receipt:memberToolReceiptOutput};
export type MemberToolName=keyof typeof memberToolInputs;
export const memberToolEffects={cbim_member_inspect:'read',cbim_member_change_preview:'preview',cbim_member_change_commit:'knowledge-write',cbim_member_receipt:'read'} as const;
export type MemberToolChange=z.infer<typeof memberToolChangeSchema>;
export interface MemberToolBinding {workspaceId:string;instanceId:string;rootSessionId:string;scopeId:string;agentInstanceId:string;agentSessionId:string;runId:string}
/** 本轮真实调用 ID 在门禁后独立传递；业务参数不能指定它。 */
export interface WorkspaceMemberToolsPort {call(name:MemberToolName,input:unknown,signal:AbortSignal,toolCallId?:string):Promise<unknown>}
