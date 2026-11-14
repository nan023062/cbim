/**
 * 作用定位：主 Loop 资源仓库只读工具的严格分页、正文分块协议和可信捕获端口。
 * 设计原因：模型只能选择已装配链接器和资源，不提供仓库身份、共享代际或权限；有界输出保留完整正文指纹和分页版本，避免部分内容冒充全文。
 * 职责边界：资料仅供参考，不安装、应用或执行；端口由主进程捕获实际授权，协议本身不授予网络或成员能力。
 */
import {z} from 'zod';
import {connectorIdSchema} from './definition';
import {repositoryToolScopeSchema} from '../../tools/rules/scope-schema';

const revision=z.string().regex(/^[a-f0-9]{64}$/),offset=z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const repositoryToolLimits={listItems:50,contentCharacters:4096} as const;
const resource=z.object({id:z.string().uuid(),kind:z.enum(['connector','team','agent','skill','architecture','module','workflow']),name:z.string().max(100),summary:z.string().max(1000),updatedAt:z.string().datetime()}).strict();
/** 首次目录可不指定版本；后续页必须锁定此前真实返回的仓库 revision。 */
export const repositoryListInputSchema=z.object({connectorId:connectorIdSchema,expectedRevision:revision.optional(),offset:offset.optional(),limit:z.number().int().min(1).max(repositoryToolLimits.listItems).optional()}).strict().superRefine((value,context)=>{if((value.offset??0)>0&&!value.expectedRevision)context.addIssue({code:z.ZodIssueCode.custom,path:['expectedRevision'],message:'后续目录分页必须指定原仓库版本'})});
/** offset/limit 以 Unicode codepoint 计数，不截断代理对；正文目标始终绑定明确仓库版本。 */
export const repositoryGetInputSchema=z.object({connectorId:connectorIdSchema,expectedRevision:revision,resourceId:z.string().uuid(),offset:offset.optional(),limit:z.number().int().min(1).max(repositoryToolLimits.contentCharacters).optional()}).strict();
export const repositoryListOutputSchema=z.object({scope:repositoryToolScopeSchema.extend({operation:z.literal('list')}).strict(),revision,offset,totalItems:offset,items:z.array(resource).max(repositoryToolLimits.listItems),nextOffset:offset.optional(),readOnly:z.literal(true)}).strict().superRefine((value,context)=>{
  const end=value.offset+value.items.length;
  if(!Number.isSafeInteger(end)||end>value.totalItems||new Set(value.items.map(item=>item.id)).size!==value.items.length||value.nextOffset!==(end<value.totalItems?end:undefined)||end<value.totalItems&&!value.items.length)context.addIssue({code:z.ZodIssueCode.custom,message:'目录分页范围或下一页标记不一致'});
});
const content=z.object({text:z.string().max(repositoryToolLimits.contentCharacters*2),offset,totalCharacters:offset,contentHash:revision,nextOffset:offset.optional(),complete:z.boolean()}).strict().superRefine((value,context)=>{
  const size=Array.from(value.text).length,end=value.offset+size;
  if(size>repositoryToolLimits.contentCharacters||!Number.isSafeInteger(end)||end>value.totalCharacters||value.nextOffset!==(end<value.totalCharacters?end:undefined)||end<value.totalCharacters&&!size||value.complete!==(value.offset===0&&end===value.totalCharacters))context.addIssue({code:z.ZodIssueCode.custom,message:'正文分块长度、范围或完整性标记不一致'});
});
/** contentHash 属于整个原正文的 UTF-8 SHA-256，不是本分块指纹；末页不自动等于完整内容。 */
export const repositoryGetOutputSchema=z.object({scope:repositoryToolScopeSchema.extend({operation:z.literal('get')}).strict(),revision,resource,content,readOnly:z.literal(true)}).strict();

/** 仅主进程提供当前已授权目标的安全摘要；授权版本、定义指纹和网络凭据留在捕获闭包。 */
export const repositoryToolTargetSchema=z.object({workspaceId:z.string().min(1),connectorId:connectorIdSchema,repositoryId:z.string().uuid(),connectionId:z.string().uuid(),name:z.string().max(100),summary:z.string().max(1000)}).strict();
export type RepositoryToolTarget=z.infer<typeof repositoryToolTargetSchema>;
export type RepositoryListInput=z.infer<typeof repositoryListInputSchema>;
export type RepositoryGetInput=z.infer<typeof repositoryGetInputSchema>;
export type RepositoryListOutput=z.infer<typeof repositoryListOutputSchema>;
export type RepositoryGetOutput=z.infer<typeof repositoryGetOutputSchema>;
/** 捕获不读 HTTP；调用绑定原目标，网络前后必须重核授权/定义/共享代际，失效不换来源也不自动重试。 */
export interface RepositoryToolsPort {
  readonly targets:readonly RepositoryToolTarget[];
  list(input:RepositoryListInput,signal:AbortSignal):Promise<RepositoryListOutput>;
  get(input:RepositoryGetInput,signal:AbortSignal):Promise<RepositoryGetOutput>;
}
