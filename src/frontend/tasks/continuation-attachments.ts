/**
 * 作用定位：校验安全等待补充的公开附件展示数据，按稳定身份合并文件、目录、链接、网页及仓库资料选择。
 * 设计原因：界面仅保存公开元数据与有序身份；正文、图片和真实性由 Main 的工作区快照复核，不能把本地草稿当成可信清单。
 */
import {z} from 'zod';
import type {ChatAttachment} from '../../bridge/contracts/chat';

const file=z.object({id:z.string().uuid(),kind:z.literal('file'),name:z.string().min(1).max(512),source:z.string().min(1).max(32768),note:z.string().max(1024).optional()}).strict();
const material=file.extend({kind:z.enum(['file','folder','link','web','repository_resource'])}).strict();
/** 公开元数据不代表来源可信；真正受理时 Main 必须核私有快照证明，旧链接器定义不等同仓库正文。 */
export function continuationAttachments(value:unknown):ChatAttachment[]{
  const items=z.array(material).max(12).parse(value);
  if(new Set(items.map(item=>item.id)).size!==items.length)throw Error('补充附件身份重复');
  return items;
}
/** 保留完整原顺序，拒绝超量与正文等私有字段，不静默裁剪用户选择。 */
export function appendContinuationAttachments(current:readonly ChatAttachment[],picked:unknown):ChatAttachment[]{
  const additions=continuationAttachments(picked),ids=new Set(current.map(item=>item.id));
  return continuationAttachments([...current,...additions.filter(item=>!ids.has(item.id))]);
}
/** 空列表仅表示未选择；发送时省略 attachmentIds，保留旧纯文本请求形状。 */
export function continuationFiles(value:unknown):ChatAttachment[]{
  const items=z.array(file).max(12).parse(value);
  if(new Set(items.map(item=>item.id)).size!==items.length)throw Error('补充附件身份重复');
  return items;
}
/** 选择器或本地存储只能提供文件元数据，拒绝正文、跨种类及超量结果，不静默裁剪用户选择。 */
export function appendContinuationFiles(current:readonly ChatAttachment[],picked:unknown):ChatAttachment[]{
  const additions=continuationFiles(picked),ids=new Set(current.map(item=>item.id));
  return continuationFiles([...current,...additions.filter(item=>!ids.has(item.id))]);
}
