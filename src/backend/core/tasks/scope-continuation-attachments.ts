/**
 * 作用定位：安全等待补充的附件 ID、紧凑快照清单及可信受理参数，供 Main、调度事务和公开回执共用。
 * 设计原因：模型实际读取的正文和图片须来自一次私有快照；持久历史只保存有限元数据及字节指纹，不复制正文、图片或原文件路径。
 * 职责边界：这里校验结构、数量和请求归属，不读取文件、不证明业务成果，也不授予工具权限或人工验收。
 */
import {z} from 'zod';
import {fail} from '../foundation/errors';

/** bytes 均为 UTF-8 文本或解码图片的字节数；旧原始补充正文另受原字符额度约束。 */
export const continuationAttachmentLimits={items:12,imageBytes:5*1024*1024,totalImageBytes:20*1024*1024,textBytes:256_000,expandedMessageBytes:512*1024,snapshotBytes:8*1024*1024} as const;
export const continuationAttachmentIdsSchema=z.array(z.string().uuid()).min(1).max(continuationAttachmentLimits.items).refine(ids=>new Set(ids).size===ids.length,'补充附件不能重复');
const digest=z.string().regex(/^[a-f0-9]{64}$/);
const bytes=z.number().int().nonnegative().safe();
const item={attachmentId:z.string().uuid(),kind:z.literal('file'),name:z.string().min(1).max(512),note:z.string().max(1024).optional(),snapshotHash:digest,contentHash:digest};
/** text/reference 的内容只表示保存的快照；没有来源文件完整性保证。mimeType 仅属于真实解码图片。 */
export const continuationAttachmentItemSchema=z.discriminatedUnion('contentKind',[
  z.object({...item,contentKind:z.literal('text'),byteLength:bytes.max(continuationAttachmentLimits.textBytes)}).strict(),
  z.object({...item,contentKind:z.literal('reference'),byteLength:bytes.max(continuationAttachmentLimits.textBytes)}).strict(),
  z.object({...item,contentKind:z.literal('image'),byteLength:bytes.min(1).max(continuationAttachmentLimits.imageBytes),mimeType:z.enum(['image/png','image/jpeg','image/gif','image/webp'])}).strict(),
]);
export type ContinuationAttachmentItem=z.infer<typeof continuationAttachmentItemSchema>;
export const continuationAttachmentManifestSchema=z.object({version:z.literal(1),items:z.array(continuationAttachmentItemSchema).min(1).max(continuationAttachmentLimits.items),expandedMessageHash:digest,expandedMessageBytes:bytes.min(1).max(continuationAttachmentLimits.expandedMessageBytes)}).strict().superRefine((value,context)=>{
  if(new Set(value.items.map(item=>item.attachmentId)).size!==value.items.length)context.addIssue({code:'custom',message:'附件清单不能重复身份'});
  if(value.items.reduce((sum,item)=>sum+(item.contentKind==='image'?item.byteLength:0),0)>continuationAttachmentLimits.totalImageBytes)context.addIssue({code:'custom',message:'图片快照合计超过 20 MiB'});
});
export type ContinuationAttachmentManifest=z.infer<typeof continuationAttachmentManifestSchema>;
/** 只由实际启动闭包传入，不属于 IPC 或模型请求；旧内核纯文本调用可没有停止信号。 */
export interface TrustedContinuationInput {attachmentManifest?:ContinuationAttachmentManifest;signal?:AbortSignal}

/** 在受理前核实一次快照清单；无附件保持旧记录缺省，有附件必须完全同序且不得遗漏或替换。 */
export function assertContinuationAttachmentManifest(input:{message:string;attachmentIds?:readonly string[]},manifest:unknown):asserts manifest is ContinuationAttachmentManifest|undefined{
  if(input.attachmentIds===undefined){if(manifest!==undefined)fail('GOAL_ATTACHMENT_MANIFEST','无附件补充不能携带附件清单');return}
  const ids=continuationAttachmentIdsSchema.safeParse(input.attachmentIds),parsed=continuationAttachmentManifestSchema.safeParse(manifest);
  if(!ids.success||!parsed.success||parsed.data.items.length!==ids.data.length||parsed.data.items.some((item,index)=>item.attachmentId!==ids.data[index])||parsed.data.expandedMessageBytes<new TextEncoder().encode(input.message).byteLength)fail('GOAL_ATTACHMENT_MANIFEST','附件清单缺失、无效或与原补充引用不一致');
}
