/**
 * 作用定位：桌面资源仓库链接器的输入、静态登记、独立只读授权与 HTTP 核验回执协议。
 * 设计原因：把可复用知识声明和本机工作区授权分开，公开真实核验的有界摘要，不把链接器登记或资源内容解释为模型执行能力。
 * 职责边界：纯数据协议，不保存共享地址、令牌、原生路径或资源正文；共享服务的连接身份只能由本机服务提供。
 */
import {z} from 'zod';
import {connectorIdSchema,resourceRepositoryConnectorDefinitionSchema} from './definition';

const id=z.string().min(1),uuid=z.string().uuid(),hash=z.string().regex(/^[a-f0-9]{64}$/),revision=z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const identityShape={workspaceId:id,instanceId:uuid};
export const repositoryConnectionIdentitySchema=z.object(identityShape).strict();
const identity=repositoryConnectionIdentitySchema;

export const repositoryConnectionListInputSchema=identity;
export const repositoryConnectionPreviewInputSchema=z.object({...identityShape,revision:id,repositoryId:uuid,connectorId:connectorIdSchema,name:z.string().min(1).max(100),summary:z.string().min(1).max(1000)}).strict();
/** 预览只持久化知识变更计划；connectionId 是当时已开启共享服务的身份，不是网络地址。 */
export const repositoryConnectionPreviewSchema=z.object({
  identity,planId:uuid,revision:id,repositoryId:uuid,connectionId:uuid,definition:resourceRepositoryConnectorDefinitionSchema,definitionHash:hash,
  changes:z.array(z.object({path:id,text:z.string().nullable()}).strict()),
  validation:z.object({structural:z.boolean(),issues:z.array(z.object({severity:z.enum(['error','warning']),code:id,message:z.string(),path:z.string().optional()}).strict()),architecture:z.literal('review-required'),business:z.literal('not-run')}).strict(),diff:z.string(),
}).strict();
export const repositoryConnectionCommitInputSchema=z.object({...identityShape,planId:uuid}).strict();
/** 只查原知识提交凭据；工作区重开后仍返回原实例身份，不凭当前定义推断成功。 */
export const repositoryConnectionCommitLookupSchema=z.object({workspaceId:id,planId:uuid}).strict();
/** committed 仅证明知识定义已提交，后续读取仍需独立 grant 与真实共享服务。 */
export const repositoryConnectionCommitSchema=z.object({identity,planId:uuid,connectorId:connectorIdSchema,repositoryId:uuid,definitionHash:hash,knowledgeRevision:id,state:z.literal('committed'),changed:z.array(z.string())}).strict();

/** revision 是此工作区链接器的授权 CAS，不是知识版本或仓库内容版本。 */
export const repositoryConnectionGrantSchema=z.object({workspaceId:id,connectorId:connectorIdSchema,repositoryId:uuid,definitionHash:hash,revision:revision.refine(value=>value>=1),enabled:z.boolean(),updatedAt:z.string().datetime()}).strict();
export const repositoryConnectionGrantInputSchema=z.object({...identityShape,connectorId:connectorIdSchema,repositoryId:uuid,definitionHash:hash,expectedGrantRevision:revision,commandId:uuid}).strict();
export const repositoryConnectionRevokeInputSchema=z.object({...identityShape,connectorId:connectorIdSchema,expectedGrantRevision:revision,commandId:uuid}).strict();
/** 回执查询只确认原 grant/revoke 命令，不发起读取、重放或恢复授权。 */
export const repositoryConnectionReceiptSchema=z.object({workspaceId:id,connectorId:connectorIdSchema,commandId:uuid,action:z.enum(['grant','revoke']),grant:repositoryConnectionGrantSchema}).strict();
export const repositoryConnectionLookupSchema=z.object({workspaceId:id,commandId:uuid}).strict();
/** 仅用于原实例退役后核实未受理；缺少普通回执不等于 unaccepted:true。 */
export const repositoryConnectionUnacceptedInputSchema=z.object({...identityShape,action:z.enum(['commit','grant','revoke']),id:uuid}).strict();
export const repositoryConnectionUnacceptedSchema=z.object({identity,action:z.enum(['commit','grant','revoke']),id:uuid,unaccepted:z.boolean()}).strict();

const connection=z.object({
  connectorId:connectorIdSchema,name:z.string(),summary:z.string(),provider:z.enum(['cindy_plugin','resource_repository_v1']),definitionHash:hash.optional(),repositoryId:uuid.optional(),grantRevision:revision,grant:repositoryConnectionGrantSchema.optional(),
  status:z.enum(['ready','not_shared','not_granted','definition_changed','repository_changed','unsupported','definition_missing']),
}).strict();
/** 缺失定义的已有授权仍可列出供撤销；插件映射只显示 unsupported，不虚报宿主能力。 */
export const repositoryConnectionListSchema=z.object({identity,knowledgeRevision:id,sharing:z.object({repositoryId:uuid,connectionId:uuid}).strict().optional(),connections:z.array(connection)}).strict();
export const repositoryConnectionCheckInputSchema=z.object({...identityShape,connectorId:connectorIdSchema,expectedGrantRevision:revision}).strict();
/** 最多公开前 20 项目录摘要；不含 content，不代表导入、下载或模型已调用。 */
export const repositoryConnectionCheckSchema=z.object({
  identity,connectorId:connectorIdSchema,repositoryId:uuid,definitionHash:hash,grantRevision:revision.refine(value=>value>=1),connectionId:uuid,checkedAt:z.string().datetime(),revision:id,itemCount:revision,
  items:z.array(z.object({id:uuid,kind:z.enum(['connector','team','agent','skill','architecture','module','workflow']),name:z.string(),summary:z.string(),updatedAt:z.string().datetime()}).strict()).max(20),truncated:z.boolean(),readOnly:z.literal(true),transport:z.literal('http'),
}).strict();

export type RepositoryConnectionIdentity=z.infer<typeof repositoryConnectionIdentitySchema>;
export type RepositoryConnectionListInput=z.infer<typeof repositoryConnectionListInputSchema>;
export type RepositoryConnectionList=z.infer<typeof repositoryConnectionListSchema>;
export type RepositoryConnectionPreviewInput=z.infer<typeof repositoryConnectionPreviewInputSchema>;
export type RepositoryConnectionPreview=z.infer<typeof repositoryConnectionPreviewSchema>;
export type RepositoryConnectionCommitInput=z.infer<typeof repositoryConnectionCommitInputSchema>;
export type RepositoryConnectionCommitLookup=z.infer<typeof repositoryConnectionCommitLookupSchema>;
export type RepositoryConnectionCommit=z.infer<typeof repositoryConnectionCommitSchema>;
export type RepositoryConnectionGrant=z.infer<typeof repositoryConnectionGrantSchema>;
export type RepositoryConnectionGrantInput=z.infer<typeof repositoryConnectionGrantInputSchema>;
export type RepositoryConnectionRevokeInput=z.infer<typeof repositoryConnectionRevokeInputSchema>;
export type RepositoryConnectionReceipt=z.infer<typeof repositoryConnectionReceiptSchema>;
export type RepositoryConnectionLookup=z.infer<typeof repositoryConnectionLookupSchema>;
export type RepositoryConnectionUnacceptedInput=z.infer<typeof repositoryConnectionUnacceptedInputSchema>;
export type RepositoryConnectionUnaccepted=z.infer<typeof repositoryConnectionUnacceptedSchema>;
export type RepositoryConnectionCheckInput=z.infer<typeof repositoryConnectionCheckInputSchema>;
export type RepositoryConnectionCheck=z.infer<typeof repositoryConnectionCheckSchema>;
