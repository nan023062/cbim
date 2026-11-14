/**
 * 作用定位：业务模块语义树及其绑定源码目录的按需浏览。
 * 设计原因：模块层级来自知识快照，目录内容由只读 IPC 查询；折叠不递归扫描磁盘，旧版本卸载后不接纳迟到响应。
 */
import {useEffect,useState,type ReactNode} from 'react';
import type {Snapshot} from '../../bridge/contracts/workspace';
import type {SourceTarget,SourceDirectory} from '../../bridge/contracts/ipc-workspace';
import {Icon} from '../components/Icon';
import {TreeActions,type TreeAction} from '../components/TreeActions';
import '../knowledge/knowledge-files.css';
/** 每个目录独立请求；下一页只在显式点击后读取。目录变动由用户刷新整个分支。 */
function SourceFolder({target,name,selected,onFile}:{target:SourceTarget;name:string;selected?:SourceTarget;onFile:(target:SourceTarget)=>void}){
 const [open,setOpen]=useState(false),[data,setData]=useState<SourceDirectory>(),[offset,setOffset]=useState(0),[refresh,setRefresh]=useState(0),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const key=JSON.stringify(target);
 useEffect(()=>{
  if(!open)return;let active=true;setBusy(true);setError('');
  void window.cbim.call('source.list',{...target,offset}).then(value=>{if(active)setData(old=>({entries:offset?[...(old?.entries??[]),...value.entries.filter(entry=>!old?.entries.some(item=>item.path===entry.path))]:value.entries,nextOffset:value.nextOffset}))},cause=>{if(active)setError(cause instanceof Error?cause.message:String(cause))}).finally(()=>{if(active)setBusy(false)});
  return()=>{active=false};
 },[key,offset,refresh,open]);
 const reload=()=>{setData(undefined);setOffset(0);setRefresh(value=>value+1)};
 return <li><div className="knowledge-file-row"><button className="knowledge-file-name source-folder-name" aria-expanded={open} aria-label={(open?'折叠源目录 ':'展开源目录 ')+name} onClick={()=>setOpen(value=>!value)}><Icon name="folder" size={15}/><span>{name}</span><Icon name="chevron" size={12}/></button>{open&&<button title="刷新目录" aria-label={'刷新目录 '+name} disabled={busy} onClick={reload}><Icon name="refresh" size={14}/></button>}</div>
  {open&&<ul>{data?.entries.map(entry=>entry.kind==='directory'?<SourceFolder key={entry.path} target={{...target,path:entry.path}} name={entry.name} selected={selected} onFile={onFile}/>:<li key={entry.path}><div className={'knowledge-file-row'+(selected?.moduleId===target.moduleId&&selected?.source===target.source&&selected?.path===entry.path?' selected':'')}><button className="knowledge-file-name" data-source-path={target.source+'/'+entry.path} title={target.source+'/'+entry.path} onClick={()=>onFile({...target,path:entry.path})}><Icon name="file" size={15}/><span>{entry.name}</span></button></div></li>)}
   {busy&&<li role="status">正在读取目录…</li>}{error&&<li role="alert">{error}<button onClick={reload}>重试目录</button></li>}
   {!busy&&!error&&data&&!data.entries.length&&data.nextOffset===undefined&&<li>目录为空或没有可浏览的业务文件。</li>}
   {!busy&&!error&&data?.nextOffset!==undefined&&<li><button onClick={()=>setOffset(data.nextOffset!)}>加载更多文件</button></li>}
  </ul>}
 </li>;
}
export function ModuleSourceTree({snapshot,query,selected,source,onModule,onFile,actions}:{snapshot:Snapshot;query:string;selected:string;source?:SourceTarget;onModule:(id:string)=>void;onFile:(target:SourceTarget)=>void;actions:(id:string)=>TreeAction[]}){
 const [closed,setClosed]=useState(new Set<string>()),tree=snapshot.validation?.tree,needle=query.trim().toLocaleLowerCase();
 const matches=(id:string,seen=new Set<string>()):boolean=>{const node=tree?.nodes[id];if(!node||seen.has(id))return false;const next=new Set(seen).add(id);return !needle||[node.name,node.summary,id].some(value=>value.toLocaleLowerCase().includes(needle))||node.children.some(child=>matches(child,next))};
 const row=(id:string,ancestors=new Set<string>()):ReactNode=>{
  const node=tree?.nodes[id];if(!node||!matches(id))return null;
  if(ancestors.has(id))return <li key={id} role="alert">模块包含关系存在循环，请检查配置。</li>;
  const seen=new Set(ancestors).add(id),open=!!needle||!closed.has(id);
  return <li key={id}><div className={'knowledge-file-row'+(selected===id&&!source?' selected':'')}><button className="knowledge-file-name" data-module-id={id} title={node.name+' · '+id} onClick={()=>onModule(id)}><Icon name="module" size={15}/><span>{node.name}</span></button><button className="knowledge-file-toggle" aria-label={(open?'折叠模块 ':'展开模块 ')+node.name} aria-expanded={open} onClick={()=>setClosed(old=>{const next=new Set(old);next.has(id)?next.delete(id):next.add(id);return next})}><Icon name="chevron" size={13}/></button><TreeActions name={node.name} actions={actions(id)}/></div>
   {open&&<ul>{node.children.map(child=>row(child,seen))}{node.sources.map((binding,index)=><SourceFolder key={index+':'+binding.location} name={binding.location} target={{workspaceId:snapshot.workspaceId,instanceId:snapshot.instanceId,revision:snapshot.revision,moduleId:id,source:binding.location.replaceAll('\\','/'),path:''}} selected={source} onFile={onFile}/>)}</ul>}
  </li>;
 };
 return <nav className="knowledge-file-tree" aria-label="业务模块源码树"><div className="knowledge-file-row"><button className="knowledge-file-name" data-module-id=".cbim/workspace" onClick={()=>onModule('.cbim/workspace')}><Icon name="module" size={15}/><span>业务模块</span></button><TreeActions name="业务模块" actions={actions('.cbim/workspace')}/></div><ul>{tree?.roots.map(id=>row(id))}</ul>{!tree?.roots.some(id=>matches(id))&&<p>{needle?'没有匹配的模块。':'暂无正式业务模块，请从根菜单创建。'}</p>}</nav>;
}
