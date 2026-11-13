/**
 * 作用定位：知识预览、提交、刷新及实例内维护任务的业务输出协议。
 * 设计原因：区分预览与已提交回执、取消请求与真实终态；校验返回形状不能抹去既有写入、重放事务或伪造回滚。
 * 职责边界：这些状态只属于知识事务或维护任务，不是主对话、成员任务或人工业务验收状态。
 */
import {z} from 'zod';
import {knowledgeOutputIdSchema,knowledgeOutputHashSchema,knowledgeIdentityShape,knowledgeValidationSchema,knowledgeContextSchema} from './tool-output-base';

const change=z.object({path:knowledgeOutputIdSchema,text:z.string().nullable()}).strict();
const request=z.object({...knowledgeIdentityShape,requestId:knowledgeOutputIdSchema,changes:z.array(change)}).strict();
/** changes 可额外包含派生索引；空正文、删除和无正文变化均保持领域原意。 */
export const knowledgePreviewOutputSchema=z.object({request,changes:z.array(change),validation:knowledgeValidationSchema,affected:z.array(z.string()),diff:z.string(),fingerprint:knowledgeOutputHashSchema}).strict();
export const knowledgeCommitOutputSchema=z.object({...knowledgeIdentityShape,state:z.literal('committed'),requestId:knowledgeOutputIdSchema,changed:z.array(z.string())}).strict();
export const objectPreviewOutputSchema=knowledgePreviewOutputSchema.extend({planId:knowledgeOutputIdSchema,objects:z.array(z.string()),notice:z.string()}).strict();
export const objectCommitOutputSchema=knowledgeCommitOutputSchema.extend({cleanupWarnings:z.array(z.string())}).strict();

/** 更新派生索引之后仍可能观察到结构问题；indexesUpdated:true 不等于知识或业务验收通过。 */
export const knowledgeRefreshOutputSchema=z.discriminatedUnion('indexesUpdated',[
  z.object({...knowledgeContextSchema.shape,state:z.literal('invalid'),indexesUpdated:z.literal(false),validation:knowledgeValidationSchema}).strict(),
  z.object({...knowledgeContextSchema.shape,state:z.enum(['refreshed','invalid']),indexesUpdated:z.literal(true),changed:z.array(z.string()),validation:knowledgeValidationSchema,notice:z.string()}).strict(),
]);

const taskBase={id:knowledgeOutputIdSchema,workspaceId:knowledgeOutputIdSchema,name:z.enum(['validate','reindex']),progress:z.string()};
/** 运行态不承诺停止；完成结果按真实维护类别区分，失败或取消保留原错误。 */
export const maintenanceTaskOutputSchema=z.union([
  z.object({...taskBase,state:z.literal('running')}).strict(),
  z.object({...taskBase,name:z.literal('validate'),state:z.literal('completed'),result:knowledgeValidationSchema}).strict(),
  z.object({...taskBase,name:z.literal('reindex'),state:z.literal('completed'),result:knowledgeCommitOutputSchema}).strict(),
  z.object({...taskBase,state:z.enum(['failed','cancelled']),error:z.string()}).strict(),
]);
export const maintenanceTaskStatusOutputSchema=z.union([maintenanceTaskOutputSchema,z.object({state:z.literal('not_found')}).strict()]);

export type KnowledgePreviewOutput=z.infer<typeof knowledgePreviewOutputSchema>;
export type KnowledgeCommitOutput=z.infer<typeof knowledgeCommitOutputSchema>;
export type MaintenanceTaskOutput=z.infer<typeof maintenanceTaskOutputSchema>;
