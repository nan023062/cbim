/**
 * 作用定位：按 Cindy ThumbnailStrip 的 56px 卡片、类型标识和角落移除按钮展示草稿附件。
 * 设计原因：点击读取当前工作区已保存的附件快照，避免预览与实际送入模型的文本不一致。
 * 图片卡片从快照读取缩略展示，不使用原路径或外部 URL；卸载/换工作区丢弃迟到回包，原字节不写界面草稿存储。
 * 来源参考：Cindy ComposerAttachments.tsx，Apache-2.0，许可见 legal。
 */
import {useEffect,useRef,useState} from 'react';
import type {ChatAttachment,ChatAttachmentPreview} from '../../bridge/contracts/chat';
import {Icon} from '../components/Icon';
const kinds={file:'文件',folder:'目录清单',link:'链接指针',web:'网页摘录',connector:'链接器定义',repository_resource:'仓库静态资料'};
/** 只加载已知图片快照，固定 data MIME；文字/目录仍显示原类型图标。 */
function AttachmentImage({item,workspaceId}:{item:ChatAttachment;workspaceId:string}){
  const [image,setImage]=useState<ChatAttachmentPreview['image']>(),[error,setError]=useState('');
  useEffect(()=>{let live=true;setImage(undefined);setError('');
    if(item.kind==='file'&&/^(图片快照|剪贴板图片)/.test(item.note??''))void window.cbim.call('chat.preview',{id:workspaceId,attachmentId:item.id}).then(value=>{if(live)setImage(value.image)}).catch((error:Error)=>{if(live)setError(error.message)});
    return()=>{live=false};
  },[item.id,item.kind,item.note,workspaceId]);
  return image?<img className="attachment-thumbnail" alt={item.name} src={`data:${image.mimeType};base64,${image.data}`}/>:<span title={error||undefined}><Icon name={item.kind==='folder'?'folder':item.kind==='connector'?'plug':'knowledge'} size={22}/>{error&&<small>预览失败</small>}</span>;
}
export function ComposerAttachments({items,workspaceId,disabled,onRemove}:{items:ChatAttachment[];workspaceId:string;disabled:boolean;onRemove:(id:string)=>void}){
  const [preview,setPreview]=useState<ChatAttachmentPreview>(),[error,setError]=useState(''),[loading,setLoading]=useState('');const dialog=useRef<HTMLDialogElement>(null),request=useRef(0);
  useEffect(()=>{request.current++;setPreview(undefined);setError('');setLoading('');return()=>{request.current++}},[workspaceId]);
  useEffect(()=>{if(preview)dialog.current?.showModal()},[preview]);
  async function show(item:ChatAttachment){const token=++request.current;setLoading(item.id);setError('');try{const result=await window.cbim.call('chat.preview',{id:workspaceId,attachmentId:item.id});if(token===request.current)setPreview(result)}catch(e:any){if(token===request.current)setError(e.message)}finally{if(token===request.current)setLoading('')}}
  return <>{items.length>0&&<div className="composer-attachments" aria-label="待发送附件">{items.map(item=><div className="composer-attachment" key={item.id}><button className="attachment-preview" title={item.source} aria-label={'预览附件 '+item.name} disabled={disabled} onClick={()=>void show(item)}><span className="attachment-type"><AttachmentImage item={item} workspaceId={workspaceId}/></span><span className="attachment-info"><b>{item.name}</b><small>{loading===item.id?'正在读取…':kinds[item.kind]}</small></span></button><button className="attachment-remove" aria-label={'移除附件 '+item.name} disabled={disabled} onClick={()=>onRemove(item.id)}><Icon name="close" size={12}/></button></div>)}</div>}{error&&<p role="alert" className="composer-attachment-error">{error}</p>}{preview&&<dialog ref={dialog} className="attachment-dialog" onCancel={()=>setPreview(undefined)} onClose={()=>setPreview(undefined)}><header><b>{preview.name}</b><button aria-label="关闭附件预览" onClick={()=>dialog.current?.close()}><Icon name="close" size={16}/></button></header><p>{preview.source}</p>{preview.note&&<p className="attachment-note">{preview.note}</p>}<>{preview.image&&<img className="attachment-full-image" alt={preview.name} src={`data:${preview.image.mimeType};base64,${preview.image.data}`}/>}</><pre>{preview.text||'该附件没有文本内容。'}</pre></dialog>}</>;
}
