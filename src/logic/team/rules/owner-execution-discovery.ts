/**
 * 作用定位：岗位执行选择的有界只读发现协议，供主工具和任务详情共用。
 * 设计原因：显式/父级关系优先；无关系时可接受主模型依据当前知识的岗位匹配，无匹配返回主会话执行，不伪造责任登记；当前观察不是未来成员领取许可，不返回能力正文或凭据。
 */
import {z} from 'zod';
import {ownerExecutionBindingSchema,ownerExecutionSelectionSchema} from './member-execution-binding';
import {workspaceRegistryCursorSchema} from './workspace-member';
import {moduleOwnershipCursorSchema} from '../../workspace/rules/module-ownership';
import {knowledgeSourceCursorSchema} from '../../workspace/rules/knowledge-source';
const id=z.string().min(1).max(1024),modules=z.array(id).min(1).max(50).refine(items=>new Set(items).size===items.length);
const issue=z.object({code:z.string().min(1).max(100),message:z.string().min(1).max(1000)}).strict();
/** 当前主模型依据模块正文和已启用岗位能力作一次选择；null 明确表示无匹配，既有责任优先。 */
export const moduleOwnerMatchesSchema=z.object({knowledgeRevision:z.string().regex(/^[a-f0-9]{64}$/),choices:z.array(z.object({moduleId:id,memberId:z.string().uuid().nullable(),reason:z.string().trim().min(1).max(2000)}).strict()).min(1).max(50)}).strict().refine(value=>new Set(value.choices.map(item=>item.moduleId)).size===value.choices.length,'模块匹配不得重复');
export type ModuleOwnerMatches=z.infer<typeof moduleOwnerMatchesSchema>;
export const ownerExecutionDiscoverySchema=z.object({workspaceId:id,instanceId:id,readOnly:z.literal(true),checkedAt:z.string().datetime(),knowledgeRevision:id,
  registryCursor:workspaceRegistryCursorSchema.nullable(),ownershipCursor:moduleOwnershipCursorSchema.nullable(),sourceCursor:knowledgeSourceCursorSchema.nullable(),moduleIds:modules,
  groups:z.array(z.object({moduleIds:modules,memberId:z.string().uuid().optional(),memberName:z.string().min(1).max(100).optional(),agentId:id.optional(),
    execution:z.enum(['main','member']).optional(),selection:ownerExecutionSelectionSchema.optional(),issues:z.array(issue).max(20)}).strict()).min(1).max(50),
}).strict().superRefine((value,context)=>{
  const all=value.groups.flatMap(group=>group.moduleIds);
  if(all.length!==value.moduleIds.length||new Set(all).size!==all.length||all.some(id=>!value.moduleIds.includes(id))||value.groups.some(group=>group.execution==='main'?group.agentId!=='cbim:main'||!!group.selection||!!group.memberId:group.selection?!group.memberName||!group.agentId||group.issues.length>0||group.memberId!==group.selection.memberId||group.selection.expectedOwners.length!==group.moduleIds.length||group.moduleIds.some(id=>!group.selection!.expectedOwners.some(owner=>owner.moduleId===id)):!group.issues.length))context.addIssue({code:'custom',message:'岗位发现的模块、预期或缺口不一致'});
  if([value.registryCursor,value.ownershipCursor,value.sourceCursor].some(cursor=>cursor&&cursor.workspaceId!==value.workspaceId))context.addIssue({code:'custom',message:'岗位发现游标不属于当前工作区'});
});
export type OwnerExecutionDiscovery=z.infer<typeof ownerExecutionDiscoverySchema>;
export const taskOwnerInspectInputSchema=z.object({workspaceId:id,rootSessionId:id,taskId:id}).strict();
export const taskOwnerInspectOutputSchema=z.object({identity:z.object({workspaceId:id,rootSessionId:id}).strict(),taskId:id,taskRevision:z.number().int().positive().safe(),ownerBinding:ownerExecutionBindingSchema.optional(),current:ownerExecutionDiscoverySchema}).strict().refine(value=>value.current.workspaceId===value.identity.workspaceId&&(!value.ownerBinding||value.ownerBinding.workspaceId===value.identity.workspaceId),'原任务与当前岗位观察不属于同一工作区');
export type TaskOwnerInspectInput=z.infer<typeof taskOwnerInspectInputSchema>;
export type TaskOwnerInspectOutput=z.infer<typeof taskOwnerInspectOutputSchema>;
