/**
 * 作用定位：装配一个频道草稿与文件选择器，提供独立输入和在途导入状态。
 * 设计原因：所有异步结果捕获原 store 与可见代次；浏览其他频道、成员或办公室时撤销未完成的资料选择，不触碰已受理执行。
 */
import {useEffect,useMemo,useRef,useState} from 'react';
import {ChannelDraftStore,type ChannelDraftIdentity} from './channel-draft';
export function useChannelDraft(identity:ChannelDraftIdentity,active:boolean){
 const store=useMemo(()=>new ChannelDraftStore(identity,window.localStorage),[identity.workspaceId,identity.rootSessionId,identity.scopeId]);
 const [,render]=useState(0),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const mounted=useRef(false),selection=useRef({store,active,generation:0}),lock=useRef(false);
 if(selection.current.store!==store||selection.current.active!==active)selection.current={store,active,generation:selection.current.generation+1};
 useEffect(()=>{mounted.current=true;const off=store.subscribe(()=>render(value=>value+1));return()=>{mounted.current=false;store.cancelImport();off()}},[store]);
 useEffect(()=>{if(!active){store.cancelImport();lock.current=false;setBusy(false)}},[active,store]);
 const change=(work:()=>void)=>{try{work();setError('')}catch(e){setError(String(e))}};
 const importFiles=async(files?:File[])=>{
  if(!active||lock.current)return;lock.current=true;setBusy(true);setError('');const token=store.beginImport(),generation=selection.current.generation;
  const current=()=>mounted.current&&selection.current.store===store&&selection.current.active&&selection.current.generation===generation;
  try{const items=files?await window.cbim.importFiles(identity.workspaceId,files):await window.cbim.call('chat.pick',{id:identity.workspaceId,kind:'file'});if(current())store.finishImport(token,items)}catch(e){if(current())setError(String(e))}finally{if(current()){lock.current=false;setBusy(false)}}
 };
 return {store,value:store.snapshot,error:error||store.error,busy,edit:(text:string)=>change(()=>store.edit({text})),remove:(id:string)=>change(()=>store.edit({attachments:store.snapshot.attachments.filter(item=>item.id!==id)})),importFiles,clear:(revision:number)=>change(()=>store.clearIfUnchanged(revision))};
}
export type ChannelDraftView=ReturnType<typeof useChannelDraft>;
