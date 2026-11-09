/**
 * 作用定位：安全等待资料导入的严格来源摘要与私有文本快照协议，供 Main 保存及 Core 清单校验共用。
 * 设计原因：目录首层、URL 指针、网页摘录和真实仓库正文是不同事实；显式版本及分支防止旧链接器定义被补称已授权内容。
 * 职责边界：不读取文件或网络、不核发授权；来源由 Main 实际导入生成，协议通过仅说明结构一致，不证明当前来源未变化或业务已验收。
 */
import {z} from 'zod';

/** 所有文本额度按 UTF-8 字节计；目录不递归，网页限制原始响应，资源限制所读取的完整正文。 */
export const continuationSourceLimits={directoryEntries:200,webResponseBytes:1024*1024,savedTextBytes:64*1024,resourceContentBytes:8*1024*1024} as const;
const hash=z.string().regex(/^[a-f0-9]{64}$/),bytes=z.number().int().nonnegative().safe();
const savedBytes=bytes.max(continuationSourceLimits.savedTextBytes);
/** 保留实际 URL，不规范化改写 wire；仅允许无用户名/密码的 HTTP(S) 地址。 */
export const continuationSourceUrlSchema=z.string().min(1).max(4096).refine(value=>{
  if(value.trim()!==value||/[\x00-\x20\x7f]/.test(value))return false;
  try{const url=new URL(value);return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password}catch{return false}
},'资料地址必须是不含凭据的 HTTP(S) URL');
const common={capturedAt:z.string().datetime(),savedTextBytes:savedBytes};
export const continuationFolderProofSchema=z.object({...common,kind:z.literal('folder'),mode:z.literal('first_level'),entryLimit:z.literal(200),entryCount:z.number().int().min(0).max(continuationSourceLimits.directoryEntries),truncated:z.boolean()}).strict();
export const continuationLinkProofSchema=z.object({...common,kind:z.literal('link'),mode:z.literal('url_only'),url:continuationSourceUrlSchema}).strict();
export const continuationWebProofSchema=z.object({...common,kind:z.literal('web'),url:continuationSourceUrlSchema,mediaType:z.string().min(1).max(256).refine(value=>!/[\r\n\x00]/.test(value)),rawBytes:bytes.max(continuationSourceLimits.webResponseBytes),rawHash:hash,extraction:z.enum(['text','html_text']),truncated:z.boolean()}).strict();
export const continuationRepositoryProofSchema=z.object({...common,kind:z.literal('repository_resource'),provider:z.literal('resource_repository_v1'),connectorId:z.string().regex(/^\.cbim\/connectors\/[A-Za-z0-9_-]+$/),repositoryId:z.string().uuid(),connectionId:z.string().uuid(),definitionHash:hash,grantRevision:z.number().int().positive().safe(),revision:hash,resourceId:z.string().uuid(),resourceKind:z.enum(['connector','team','agent','skill','architecture','module','workflow']),fullContentHash:hash,fullContentBytes:bytes.max(continuationSourceLimits.resourceContentBytes),truncated:z.boolean(),readOnly:z.literal(true),transport:z.literal('http')}).strict();
/** 此处 grantRevision/connectionId 只记录导入当时的授权来源；不得用于继续联网、安装或执行。 */
export const continuationSourceProofSchema=z.discriminatedUnion('kind',[continuationFolderProofSchema,continuationLinkProofSchema,continuationWebProofSchema,continuationRepositoryProofSchema]).superRefine((value,context)=>{
  if(value.kind==='web'){
    const type=value.mediaType.split(';',1)[0].trim().toLowerCase();
    if(!/^text\/[a-z0-9!#$&^_.+-]+$/.test(type)&&type!=='application/json'||value.extraction!==(type==='text/html'?'html_text':'text'))context.addIssue({code:'custom',message:'网页媒体类型与实际文本提取方式不一致'});
  }
  if(value.kind==='repository_resource'&&(value.savedTextBytes>value.fullContentBytes||value.truncated!==(value.savedTextBytes<value.fullContentBytes)))context.addIssue({code:'custom',message:'仓库摘录字节数与完整正文或截取标记不一致'});
});
export type ContinuationSourceProof=z.infer<typeof continuationSourceProofSchema>;
const metadata={version:z.literal(1),id:z.string().uuid(),name:z.string().min(1).max(512),source:z.string().min(1).max(32768),note:z.string().max(1024).optional(),text:z.string().max(continuationSourceLimits.savedTextBytes)};
/** 新来源必须有明确版本和实际导入事实。旧 file/image 不经过此 schema；无版本旧非 file 不自动迁移。 */
export const continuationSourceSnapshotSchema=z.discriminatedUnion('kind',[
  z.object({...metadata,kind:z.literal('folder'),proof:continuationFolderProofSchema}).strict(),
  z.object({...metadata,kind:z.literal('link'),proof:continuationLinkProofSchema}).strict(),
  z.object({...metadata,kind:z.literal('web'),proof:continuationWebProofSchema}).strict(),
  z.object({...metadata,kind:z.literal('repository_resource'),proof:continuationRepositoryProofSchema}).strict(),
]).superRefine((value,context)=>{
  const length=new TextEncoder().encode(value.text).byteLength;
  if(length>continuationSourceLimits.savedTextBytes||value.proof.savedTextBytes!==length)context.addIssue({code:'custom',message:'来源快照正文与实际保存字节数不一致'});
  if(!continuationSourceProofSchema.safeParse(value.proof).success)context.addIssue({code:'custom',message:'来源快照证明不完整'});
  if((value.kind==='link'||value.kind==='web')&&value.source!==value.proof.url)context.addIssue({code:'custom',message:'来源快照地址与实际导入地址不一致'});
});
export type ContinuationSourceSnapshot=z.infer<typeof continuationSourceSnapshotSchema>;
