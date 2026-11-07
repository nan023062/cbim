/**
 * 作用定位：知识工具的身份、文件、校验与快照输出协议，供注册边界及具体查询协议复用。
 * 设计原因：严格约束服务生成的结构，同时保留原始 JSON 与不合格知识的诊断事实；输出校验不重新判断业务或架构有效性。
 * 职责边界：仅核对 JSON 传输值，不读写文件、不授予权限，也不把协议通过当成结构或业务验收通过。
 */
import {z} from 'zod';

/** 原始知识字段仅保证可表达为 JSON；未知属性和错误业务类型仍是需要呈现的诊断事实。 */
export type KnowledgeJsonValue=null|boolean|number|string|KnowledgeJsonValue[]|{[key:string]:KnowledgeJsonValue};
function isJsonValue(value:unknown):value is KnowledgeJsonValue{
  const active=new Set<object>(),pending:Array<{value:unknown;leave?:boolean}>=[{value}];
  while(pending.length){
    const item=pending.pop()!,current=item.value;
    if(item.leave){active.delete(current as object);continue}
    if(current===null||typeof current==='string'||typeof current==='boolean')continue;
    if(typeof current==='number'){if(!Number.isFinite(current))return false;continue}
    if(typeof current!=='object'||active.has(current)||Object.getOwnPropertySymbols(current).length)return false;
    const prototype=Object.getPrototypeOf(current);
    if(!Array.isArray(current)&&prototype!==Object.prototype&&prototype!==null)return false;
    active.add(current);pending.push({value:current,leave:true});
    for(const child of Array.isArray(current)?[...current]:Object.values(current))pending.push({value:child});
  }
  return true;
}
/**
 * 自定义谓词仅检查且原样返回；Zod record 会删除合法 JSON 自有 __proto__ 键，不能用于这些原始事实槽。
 * JSON Schema 中该字段允许任意 JSON 值，与传输快照语义一致；外层服务对象仍使用严格字段协议。
 */
export const jsonValueSchema=z.custom<KnowledgeJsonValue>(isJsonValue).describe('原样 JSON 诊断事实，不证明知识定义有效');
/** 定义文件的原样对象；字段约束属于知识校验器，不由返回协议覆盖。 */
export const knowledgeJsonObjectSchema=z.custom<{[key:string]:KnowledgeJsonValue}>(value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&isJsonValue(value)).describe('原样知识定义 JSON 对象，不重新施加知识有效性约束');
export const knowledgeOutputIdSchema=z.string().min(1);
export const knowledgeOutputHashSchema=z.string().regex(/^[a-f0-9]{64}$/);

/** path 是知识标识；text 保留空正文，哈希只声明内容版本，不授予原生文件访问权。 */
export const knowledgeFileSchema=z.object({path:knowledgeOutputIdSchema,text:z.string(),hash:knowledgeOutputHashSchema}).strict();
export const knowledgeIssueSchema=z.object({severity:z.enum(['error','warning']),code:knowledgeOutputIdSchema,message:z.string(),path:z.string().optional()}).strict();
export const knowledgeIdentityShape={workspaceId:knowledgeOutputIdSchema,instanceId:knowledgeOutputIdSchema,revision:knowledgeOutputHashSchema};
/** structural:false 与 error 问题仍是合法返回，不因增加输出契约而吞掉诊断。 */
export const knowledgeContextSchema=z.object({...knowledgeIdentityShape,structural:z.boolean(),issues:z.array(knowledgeIssueSchema)}).strict();

const source=z.object({location:z.string(),scope:z.string()}).strict();
const node=z.object({id:knowledgeOutputIdSchema,name:z.string(),summary:z.string(),sources:z.array(source),children:z.array(z.string()),virtual:z.boolean().optional()}).strict();
const skillEntry=z.object({name:z.string(),purpose:z.string(),reference:z.string(),owner:z.string(),scope:z.enum(['agent','team'])}).strict();
/** 派生树与 Skill 记录具有固定形状；正文及引用是否有效仍以 issues 表达。 */
export const knowledgeValidationSchema=z.object({
  issues:z.array(knowledgeIssueSchema),indexes:z.record(z.string()),
  tree:z.object({nodes:z.record(node),roots:z.array(z.string())}).strict(),
  skills:z.record(z.object({chain:z.array(z.string()),entries:z.array(skillEntry)}).strict()).optional(),
  structural:z.boolean(),architecture:z.literal('review-required'),business:z.literal('not-run'),
}).strict();

/** 仅返回当前真实实例状态；writeEnabled 描述本次可信调用参数，不是可复用授权。 */
export const workspaceIdentityOutputSchema=z.object({workspaceId:knowledgeOutputIdSchema,root:knowledgeOutputIdSchema,instanceId:knowledgeOutputIdSchema,state:knowledgeOutputIdSchema,writeEnabled:z.boolean()}).strict();
export const knowledgeSnapshotOutputSchema=z.object({...knowledgeIdentityShape,files:z.array(knowledgeFileSchema),validation:knowledgeValidationSchema}).strict();
/** 搜索只筛选 files，revision 仍属于整个读取版本；不从子集补造完整校验。 */
export const knowledgeSearchOutputSchema=z.object({...knowledgeIdentityShape,files:z.array(knowledgeFileSchema),validation:knowledgeValidationSchema.optional()}).strict();

export type KnowledgeSnapshotOutput=z.infer<typeof knowledgeSnapshotOutputSchema>;
export type KnowledgeSearchOutput=z.infer<typeof knowledgeSearchOutputSchema>;
