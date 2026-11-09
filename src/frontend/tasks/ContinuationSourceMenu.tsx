/**
 * 作用定位：为原目标安全等待提供目录、URL、网页及授权仓库资料的显式选择表单。
 * 设计原因：选择资料与继续目标是独立动作；共享控制器负责在途锁，表单按等待代次隔离目录页，迟到结果不能替换新选择。
 */
import {useEffect,useRef,useState} from 'react';
import type {RepositoryToolTarget,RepositoryListOutput} from '../../bridge/contracts/repository-connections';
import type {ScopeContinuationView} from './useScopeContinuation';

const resourceLabels={connector:'链接器',team:'团队',agent:'Agent',skill:'Skill',architecture:'业务架构',module:'Module',workflow:'Workflow'};
/** 只展示实际授权目标和同版本目录页；资源导入是静态资料引用，不安装、应用或执行。 */
export function ContinuationSourceMenu({state}:{state:ScopeContinuationView}){
  const [kind,setKind]=useState<'link'|'web'|'repository_resource'>(),[url,setUrl]=useState('');
  const [targets,setTargets]=useState<RepositoryToolTarget[]>([]),[targetId,setTargetId]=useState(''),[page,setPage]=useState<RepositoryListOutput>(),[resourceId,setResourceId]=useState('');
  const epoch=useRef(0),stamp=useRef(state.sourceSelectionKey),mounted=useRef(true);
  if(stamp.current!==state.sourceSelectionKey){stamp.current=state.sourceSelectionKey;epoch.current++}
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;epoch.current++}},[]);
  useEffect(()=>{setKind(undefined);setUrl('');setTargets([]);setTargetId('');setPage(undefined);setResourceId('')},[state.sourceSelectionKey]);
  const disabled=!state.editable||state.importing,full=state.attachments.length>=12;
  const target=targets.find(item=>item.connectorId===targetId);
  async function choose(next:typeof kind){
    if(disabled||full)return;const token=++epoch.current;setKind(next);setPage(undefined);setResourceId('');
    if(next==='repository_resource'){
      setTargets([]);setTargetId('');const result=await state.materialTargets();
      if(mounted.current&&token===epoch.current&&result)setTargets(result);
    }
  }
  async function load(offset=0){
    if(disabled||!target)return;const token=++epoch.current;
    const result=await state.materialList({target,...(page?{expectedRevision:page.revision}:{}),offset});
    if(mounted.current&&token===epoch.current&&result){setPage(result);setResourceId('')}
  }
  return <section className="continuation-sources" data-testid="continuation-sources" aria-label="补充资料来源">
    <div className="scope-continuation-actions">
      <button disabled={disabled||full} data-testid="scope-continuation-folder" onClick={()=>void state.importSource({kind:'folder'})}>目录清单</button>
      <button disabled={disabled||full} aria-pressed={kind==='link'} data-testid="scope-continuation-link" onClick={()=>void choose('link')}>链接</button>
      <button disabled={disabled||full} aria-pressed={kind==='web'} data-testid="scope-continuation-web" onClick={()=>void choose('web')}>网页</button>
      <button disabled={disabled||full} aria-pressed={kind==='repository_resource'} data-testid="scope-continuation-repository" onClick={()=>void choose('repository_resource')}>仓库资料</button>
      {state.importing&&<button data-testid="scope-continuation-import-cancel" onClick={state.cancelImport}>取消资料准备</button>}
    </div>
    {kind&&kind!=='repository_resource'&&<form onSubmit={event=>{event.preventDefault();if(!disabled&&!full&&url.trim())void state.importSource({kind,value:url.trim()})}}>
      <label>{kind==='link'?'链接地址（仅保存指针）':'网页地址（实际读取文本）'}<input aria-label="补充资料地址" type="url" required value={url} disabled={disabled} onChange={event=>setUrl(event.target.value)} placeholder="https://…"/></label>
      <p className="scope-goal-muted">{kind==='link'?'链接不会被自动打开或抓取。':'保存有界文本摘录，不执行网页脚本；超出范围或重定向会报告。'}</p>
      <button type="submit" data-testid="scope-continuation-source-add" disabled={disabled||full||!url.trim()}>保存资料快照</button>
    </form>}
    {kind==='repository_resource'&&<div className="continuation-repository-picker">
      <p className="scope-goal-muted">仅列出已授权的资源仓库；保存静态资料，不安装或执行。选择目录页后固定仓库版本。</p>
      {!state.importing&&!targets.length&&<p>没有可用的已授权仓库。请先在链接器中登记并授权资源仓库。</p>}
      {!!targets.length&&<><label>资料仓库<select aria-label="补充资料仓库" disabled={disabled} value={targetId} onChange={event=>{epoch.current++;setTargetId(event.target.value);setPage(undefined);setResourceId('')}}><option value="">选择已授权仓库</option>{targets.map(item=><option key={item.connectorId} value={item.connectorId}>{item.name}</option>)}</select></label>
        <button disabled={disabled||!target} data-testid="scope-continuation-material-list" onClick={()=>void load(0)}>读取资料目录</button></>}
      {page&&target&&<><label>静态资料<select aria-label="补充仓库静态资料" value={resourceId} disabled={disabled} onChange={event=>setResourceId(event.target.value)}><option value="">选择资料</option>{page.items.map(item=><option key={item.id} value={item.id}>{resourceLabels[item.kind]} · {item.name}</option>)}</select></label>
        <div className="scope-continuation-actions"><button disabled={disabled||page.offset===0} onClick={()=>void load(Math.max(0,page.offset-50))}>上一页</button><span>第 {page.items.length?page.offset+1:0}–{page.offset+page.items.length} 项 / 共 {page.totalItems} 项</span><button disabled={disabled||page.nextOffset===undefined} onClick={()=>void load(page.nextOffset!)}>下一页</button></div>
        <button disabled={disabled||full||!resourceId} data-testid="scope-continuation-material-add" onClick={()=>void state.importSource({kind:'repository_resource',connectorId:target.connectorId,connectionId:target.connectionId,expectedRevision:page.revision,resourceId})}>保存选中资料快照</button></>}
    </div>}
    {state.importing&&<p role="status">正在准备资料；取消或切换目标后，迟到结果不会加入草稿。原生文件选择框请自行关闭。</p>}
  </section>;
}
