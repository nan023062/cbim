/**
 * 作用定位：按工作区/主会话/频道持有未提交的文本和附件草稿，独立于主聊天及执行命令账本。
 * 设计原因：输入状态不随浏览选择迁移；提交后仅清除相同版本，迟到的附件选择不能写进新频道或已关闭的视图。
 */
import type {ChatAttachment} from '../../bridge/contracts/chat';
import {continuationAttachments,appendContinuationAttachments} from '../tasks/continuation-attachments';
import {SubscriptionSet,type TextStorage} from '../foundations/utility';
export interface ChannelDraft {text:string;attachments:ChatAttachment[];revision:number}
export interface ChannelDraftIdentity {workspaceId:string;rootSessionId:string;scopeId:string}
/** 草稿不是执行授权；损坏/无法持久化时保留原数据并禁止发送，不能按空草稿覆盖。 */
export class ChannelDraftStore {
 private value:ChannelDraft={text:'',attachments:[],revision:0};
 private listeners=new SubscriptionSet();
 private generation=0;
 private blocked=false;
 error='';
 readonly key:string;
 constructor(readonly identity:ChannelDraftIdentity,private storage:TextStorage){
  this.key='cbim.channel-draft.v1.'+JSON.stringify([identity.workspaceId,identity.rootSessionId,identity.scopeId]);
  try{const raw=storage.getItem(this.key);if(raw){if(raw.length>512*1024)throw Error('频道草稿过大');const parsed=JSON.parse(raw);if(typeof parsed.text!=='string'||parsed.text.length>64000||!Number.isSafeInteger(parsed.revision)||parsed.revision<0)throw Error('频道草稿格式无效');this.value={text:parsed.text,attachments:continuationAttachments(parsed.attachments),revision:parsed.revision}}}catch(error){this.blocked=true;this.error=String(error)}
 }
 /** 仅损坏记录锁定编辑；临时导入/存储失败允许修正后重试，不制造输入死锁。 */
 get writable(){return !this.blocked}
 get snapshot(){return this.value}
 subscribe(listener:()=>void){return this.listeners.subscribe(listener)}
 /** 读取/写入共用 512 Ki 字符记录上限，先持久化后发布；主聊天和原补充命令不在此键内。 */
 edit(patch:Partial<Pick<ChannelDraft,'text'|'attachments'>>){
  if(this.blocked)throw Error('原频道草稿无法读取，请先核实本机记录');
  const next={...this.value,...patch,revision:this.value.revision+1};
  if(next.text.length>64000)throw Error('频道草稿最多 64000 字符');
  next.attachments=continuationAttachments(next.attachments);
  try{const encoded=JSON.stringify(next);if(encoded.length>512*1024)throw Error('频道草稿超出本机记录上限，请减少附件后重试');this.storage.setItem(this.key,encoded);this.value=next;this.error=''}catch(error){this.error=String(error);throw error}finally{this.listeners.notify()}
 }
 /** 接收成功只清除提交时那一版；迟到回执不清空用户后来输入的内容。 */
 clearIfUnchanged(revision:number){if(this.value.revision===revision)this.edit({text:'',attachments:[]})}
 beginImport(){return ++this.generation}
 cancelImport(){this.generation++}
 /** 关闭/隐藏、换频道或新选择都会使旧 token 失效，绝不将附件附到当前选中频道。 */
 finishImport(token:number,items:unknown){if(token!==this.generation)return false;this.edit({attachments:appendContinuationAttachments(this.value.attachments,items)});return true}
}
