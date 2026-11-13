/**
 * 作用定位：安全等待补充的附件 ID、紧凑快照清单及可信受理参数，供 Main、调度事务和公开回执共用。
 * 设计原因：正文和图片须来自一次私有快照；v1 文件历史原样保留，v2 明确目录、链接、网页与仓库资料来历，不把旧定义或片段当完整来源。
 * 职责边界：这里校验结构、数量和请求归属，不读取文件、不证明业务成果，也不授予工具权限或人工验收。
 */
import {z} from 'zod';
import {fail} from '../../../core/errors';
import {continuationSourceProofSchema,continuationSourceLimits,type ContinuationSourceSnapshot} from './continuation-source-snapshot';

/** bytes 均为 UTF-8 文本或解码图片的字节数；旧原始补充正文另受原字符额度约束。 */
export const continuationAttachmentLimits={items:12,imageBytes:5*1024*1024,totalImageBytes:20*1024*1024,textBytes:256_000,expandedMessageBytes:512*1024,snapshotBytes:8*1024*1024} as const;
export const continuationAttachmentIdsSchema=z.array(z.string().uuid()).min(1).max(continuationAttachmentLimits.items).refine(ids=>new Set(ids).size===ids.length,'补充附件不能重复');
const digest=z.string().regex(/^[a-f0-9]{64}$/);
const bytes=z.number().int().nonnegative().safe();
const item={attachmentId:z.string().uuid(),kind:z.literal('file'),name:z.string().min(1).max(512),note:z.string().max(1024).optional(),snapshotHash:digest,contentHash:digest};
/** text/reference 的内容只表示保存的快照；没有来源文件完整性保证。mimeType 仅属于真实解码图片。 */
export const continuationFileItemSchema=z.discriminatedUnion('contentKind',[
  z.object({...item,contentKind:z.literal('text'),byteLength:bytes.max(continuationAttachmentLimits.textBytes)}).strict(),
  z.object({...item,contentKind:z.literal('reference'),byteLength:bytes.max(continuationAttachmentLimits.textBytes)}).strict(),
  z.object({...item,contentKind:z.literal('image'),byteLength:bytes.min(1).max(continuationAttachmentLimits.imageBytes),mimeType:z.enum(['image/png','image/jpeg','image/gif','image/webp'])}).strict(),
]);
/** 新来源仅携带正文摘要和导入事实；无原目录绝对路径、完整正文、网络令牌或可复用授权。 */
export const continuationSourceItemSchema=z.object({attachmentId:z.string().uuid(),kind:z.enum(['folder','link','web','repository_resource']),name:z.string().min(1).max(512),note:z.string().max(1024).optional(),snapshotHash:digest,contentHash:digest,byteLength:bytes.max(continuationSourceLimits.savedTextBytes),contentKind:z.enum(['directory_listing','url_reference','web_excerpt','resource_excerpt']),proof:continuationSourceProofSchema}).strict().superRefine((value,context)=>{
  const contentKinds={folder:'directory_listing',link:'url_reference',web:'web_excerpt',repository_resource:'resource_excerpt'} as const;
  if(value.proof.kind!==value.kind||value.contentKind!==contentKinds[value.kind]||value.byteLength!==value.proof.savedTextBytes)context.addIssue({code:'custom',message:'附件类型、来源证明或实际保存字节数不一致'});
  if(value.proof.kind==='repository_resource'&&!value.proof.truncated&&value.contentHash!==value.proof.fullContentHash)context.addIssue({code:'custom',message:'完整仓库正文的快照与来源指纹不一致'});
});
export type ContinuationSourceItem=z.infer<typeof continuationSourceItemSchema>;
export const continuationAttachmentItemSchema=z.union([continuationFileItemSchema,continuationSourceItemSchema]);
export type ContinuationAttachmentItem=z.infer<typeof continuationAttachmentItemSchema>;
const manifest={expandedMessageHash:digest,expandedMessageBytes:bytes.min(1).max(continuationAttachmentLimits.expandedMessageBytes)};
function checkItems(value:{items:ContinuationAttachmentItem[]},context:z.RefinementCtx){
  if(new Set(value.items.map(item=>item.attachmentId)).size!==value.items.length)context.addIssue({code:'custom',message:'附件清单不能重复身份'});
  if(value.items.reduce((sum,item)=>sum+(item.contentKind==='image'?item.byteLength:0),0)>continuationAttachmentLimits.totalImageBytes)context.addIssue({code:'custom',message:'图片快照合计超过 20 MiB'});
}
/** file/image 的旧 v1 字段及缺省语义不变；只有真实混入新来源时才使用 v2。 */
export const continuationAttachmentManifestV1Schema=z.object({version:z.literal(1),items:z.array(continuationFileItemSchema).min(1).max(continuationAttachmentLimits.items),...manifest}).strict().superRefine(checkItems);
export const continuationAttachmentManifestV2Schema=z.object({version:z.literal(2),items:z.array(continuationAttachmentItemSchema).min(1).max(continuationAttachmentLimits.items),...manifest}).strict().superRefine((value,context)=>{checkItems(value,context);if(value.items.every(item=>item.kind==='file'))context.addIssue({code:'custom',message:'只有新增来源资料使用 v2，文件历史保持 v1'})});
export type ContinuationAttachmentManifestV1=z.infer<typeof continuationAttachmentManifestV1Schema>;
export type ContinuationAttachmentManifestV2=z.infer<typeof continuationAttachmentManifestV2Schema>;
export const continuationAttachmentManifestSchema=z.union([continuationAttachmentManifestV1Schema,continuationAttachmentManifestV2Schema]);
export type ContinuationAttachmentManifest=z.infer<typeof continuationAttachmentManifestSchema>;
/** 私有快照投影为公开清单；两个哈希必须由调用方从同次实际读取字节计算，不能采用界面自报值。 */
export function continuationSourceItemFromSnapshot(snapshot:ContinuationSourceSnapshot,snapshotHash:string,contentHash:string):ContinuationSourceItem{
  const contentKinds={folder:'directory_listing',link:'url_reference',web:'web_excerpt',repository_resource:'resource_excerpt'} as const;
  return {attachmentId:snapshot.id,kind:snapshot.kind,name:snapshot.name,...(snapshot.note===undefined?{}:{note:snapshot.note}),snapshotHash,contentHash,byteLength:snapshot.proof.savedTextBytes,contentKind:contentKinds[snapshot.kind],proof:structuredClone(snapshot.proof)};
}
/** 只由实际启动闭包传入，不属于 IPC 或模型请求；旧内核纯文本调用可没有停止信号。 */
export interface TrustedContinuationInput {attachmentManifest?:ContinuationAttachmentManifest;signal?:AbortSignal}

/** 在受理前核实一次快照清单；无附件保持旧记录缺省，有附件必须完全同序且不得遗漏或替换。 */
export function assertContinuationAttachmentManifest(input:{message:string;attachmentIds?:readonly string[]},manifest:unknown):asserts manifest is ContinuationAttachmentManifest|undefined{
  if(input.attachmentIds===undefined){if(manifest!==undefined)fail('GOAL_ATTACHMENT_MANIFEST','无附件补充不能携带附件清单');return}
  const ids=continuationAttachmentIdsSchema.safeParse(input.attachmentIds),parsed=continuationAttachmentManifestSchema.safeParse(manifest);
  if(!ids.success||!parsed.success||parsed.data.items.length!==ids.data.length||parsed.data.items.some((item,index)=>item.attachmentId!==ids.data[index])||parsed.data.expandedMessageBytes<new TextEncoder().encode(input.message).byteLength)fail('GOAL_ATTACHMENT_MANIFEST','附件清单缺失、无效或与原补充引用不一致');
}
