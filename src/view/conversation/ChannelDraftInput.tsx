/**
 * 作用定位：频道专属文本/附件输入；只有外层状态允许时可编辑，不拥有发送或停止权限。
 * 设计原因：复用附件预览但不使用主聊天加号菜单，避免频道操作触发主聊天 Skill 或清空主草稿。
 */
import type {ChannelDraftView} from './useChannelDraft';
import {ComposerAttachments} from '../execution-view/ComposerAttachments';
export function ChannelDraftInput({draft,editable,label='频道草稿'}:{draft:ChannelDraftView;editable:boolean;label?:string}){
 const {value}=draft;
 return <div className="channel-draft-input" onDragOver={event=>{if(editable&&event.dataTransfer.types.includes('Files'))event.preventDefault()}} onDrop={event=>{event.preventDefault();if(editable&&!draft.busy&&event.dataTransfer.files.length)void draft.importFiles(Array.from(event.dataTransfer.files))}}>
  <textarea aria-label={label} value={value.text} readOnly={!editable} maxLength={64000} placeholder="向主 Agent 补充此频道…" onChange={event=>draft.edit(event.target.value)}/>
  <ComposerAttachments items={value.attachments} workspaceId={draft.store.identity.workspaceId} disabled={!editable||draft.busy} onRemove={draft.remove}/>
  <button disabled={!editable||draft.busy||value.attachments.length>=12} onClick={()=>void draft.importFiles()}>{draft.busy?'正在准备频道附件…':'添加频道文件或图片'}</button>
  {draft.error&&<p role="alert">{draft.error}</p>}
 </div>;
}
