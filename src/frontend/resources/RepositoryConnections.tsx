/**
 * 作用定位：在链接器页按明确工作区登记仓库身份、独立授予主 Agent 只读连接并查看真实 HTTP 核验摘要。
 * 设计原因：知识声明不能代替运行授权；每次操作固定目标与版本，异步结果仅交回原视图。写命令未知时保留原请求核实，不自动重试或换目标。
 * 职责边界：不启动共享、不展示密钥、不执行资源内容，也不把桌面核验宣称为 Agent 已调用。
 */
import {useEffect,useRef,useState} from 'react';
import type {WorkspaceView,Snapshot} from '../../bridge/contracts/workspace';
import type {RepositoryStatus} from '../../bridge/contracts/resources';
import type {
  RepositoryConnectionList,RepositoryConnectionPreview,RepositoryConnectionCheck,
} from '../../bridge/contracts/repository-connections';
import {createRepositoryConnectionPendingStore,checkedRepositoryConnectionCommit,checkedRepositoryConnectionReceipt,checkedRepositoryConnectionUnaccepted,isRepositoryConnectionPreflightRejection,type RepositoryConnectionPending} from './repository-connection-state';
import './repository-connections.css';

type Connection=RepositoryConnectionList['connections'][number];
const labels:Record<Connection['status'],string>={ready:'已授权 · 可核验',not_shared:'共享未开启',not_granted:'未授权',definition_changed:'定义已变化',repository_changed:'当前仓库不匹配',unsupported:'插件映射 · 尚未接入',definition_missing:'定义已移除'};
const message=(cause:unknown)=>cause instanceof Error?cause.message:String(cause);

/** 读取只按明确 workspaceId；卸载或切换目标使旧响应失效，授权按钮不绕过后端 CAS。 */
export function RepositoryConnections({onSettings}:{onSettings:()=>void}){
  const [workspaces,setWorkspaces]=useState<WorkspaceView[]>([]),[workspaceId,setWorkspaceId]=useState('');
  const [list,setList]=useState<RepositoryConnectionList>(),[status,setStatus]=useState<RepositoryStatus>();
  const [preview,setPreview]=useState<RepositoryConnectionPreview>(),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [slug,setSlug]=useState('resource-repository'),[name,setName]=useState('团队资源仓库');
  const [checks,setChecks]=useState<Record<string,RepositoryConnectionCheck>>({});
  const [pending,setPending]=useState<RepositoryConnectionPending>(),[storageError,setStorageError]=useState(false);
  const store=useRef(createRepositoryConnectionPendingStore({getItem:key=>window.localStorage.getItem(key),setItem:(key,value)=>window.localStorage.setItem(key,value)})).current;
  // 同步锁早于 React 重绘，拒绝双击；generation 防止旧目标结果覆盖新选择。
  const lock=useRef(false),generation=useRef(0),alive=useRef(false);
  useEffect(()=>{alive.current=true;void initial();return()=>{alive.current=false;generation.current++}},[]);
  function current(token:number){return alive.current&&generation.current===token}
  async function initial(){
    const token=++generation.current;setBusy(true);lock.current=true;
    try{const [registered,repository]=await Promise.all([window.cbim.call('list') as Promise<{entries:WorkspaceView[]}>,window.cbim.call('resources.status') as Promise<RepositoryStatus>]);if(current(token)){setWorkspaces(registered.entries);setStatus(repository)}}
    catch(cause){if(current(token))setError(message(cause))}
    finally{if(current(token)){lock.current=false;setBusy(false)}}
  }
  async function load(id:string,token:number){
    const [snapshot,repository]=await Promise.all([window.cbim.call('snapshot',{id}) as Promise<Snapshot>,window.cbim.call('resources.status') as Promise<RepositoryStatus>]);
    if(snapshot.workspaceId!==id)throw Error('工作区身份已变化，请重新选择');
    const value:RepositoryConnectionList=await window.cbim.call('resources.connection.list',{workspaceId:id,instanceId:snapshot.instanceId});
    if(value.identity.workspaceId!==id||value.identity.instanceId!==snapshot.instanceId)throw Error('连接列表身份不一致，请重新加载');
    if(current(token)){setList(value);setStatus(repository)}
  }
  async function select(id:string){
    if(lock.current)return;
    setWorkspaceId(id);setList(undefined);setPreview(undefined);setChecks({});setPending(undefined);setError('');setNotice('');
    try{setPending(id?store.read(id):undefined);setStorageError(false)}catch(cause){setStorageError(true);setError(message(cause));return}
    if(!id){generation.current++;return}
    await perform(async token=>load(id,token));
  }
  /** 每次操作独立错误边界；刷新失败不能把已取得的写回执改写成“提交失败”。 */
  async function perform(action:(token:number)=>Promise<void>){
    if(lock.current)return;lock.current=true;const token=++generation.current;setBusy(true);setError('');
    try{await action(token)}catch(cause){if(current(token))setError(message(cause))}
    finally{if(current(token)){lock.current=false;setBusy(false)}}
  }
  async function refresh(){await perform(async token=>{setPreview(undefined);setChecks({});try{setPending(workspaceId?store.read(workspaceId):undefined);setStorageError(false)}catch(cause){setStorageError(true);throw cause}if(workspaceId)await load(workspaceId,token);else{const registered:{entries:WorkspaceView[]}=await window.cbim.call('list');const repository:RepositoryStatus=await window.cbim.call('resources.status');if(current(token)){setWorkspaces(registered.entries);setStatus(repository)}}})}
  async function prepare(){
    if(!list?.sharing)return;const base=list;
    await perform(async token=>{
      setPreview(undefined);setNotice('');
      const value:RepositoryConnectionPreview=await window.cbim.call('resources.connection.preview',{
        ...base.identity,revision:base.knowledgeRevision,repositoryId:base.sharing!.repositoryId,connectorId:'.cbim/connectors/'+slug,
        name:name.trim(),summary:'连接用户明确共享的团队资源仓库。此定义只标识仓库身份，实际访问需要独立的工作区只读授权；资源仅作资料，不能自动安装、应用或执行。',
      });
      if(value.identity.workspaceId!==base.identity.workspaceId||value.identity.instanceId!==base.identity.instanceId)throw Error('预览目标身份不一致，请刷新');
      if(current(token))setPreview(value);
    });
  }
  async function commit(){
    if(!preview||!preview.validation.structural)return;const frozen=preview;
    await submit({action:'commit',input:{...frozen.identity,planId:frozen.planId},expected:{connectorId:frozen.definition.id,repositoryId:frozen.repositoryId,definitionHash:frozen.definitionHash}});
  }
  async function authorize(row:Connection,action:'grant'|'revoke'){
    if(!list)return;const identity=list.identity;
    const request:RepositoryConnectionPending=action==='grant'?{action,input:{...identity,connectorId:row.connectorId,repositoryId:row.repositoryId!,definitionHash:row.definitionHash!,expectedGrantRevision:row.grantRevision,commandId:crypto.randomUUID()}}:{action,input:{...identity,connectorId:row.connectorId,expectedGrantRevision:row.grantRevision,commandId:crypto.randomUUID()},expected:{repositoryId:row.grant!.repositoryId,definitionHash:row.grant!.definitionHash}};
    await submit(request);
  }
  /** 先保存小体积原请求再提交；首次确定拒绝可解除，已未知或恢复的请求只能继续核实。 */
  async function submit(request:RepositoryConnectionPending){
    await perform(async token=>{
      const existed=store.read(request.input.workspaceId);store.save(request);setChecks({});setPending(request);setNotice('');
      let receipt:unknown;
      try{receipt=await window.cbim.call('resources.connection.'+request.action,request.input)}
      catch(cause){if(!existed&&isRepositoryConnectionPreflightRejection(request.action,cause)){store.remove(request);if(current(token)){setPending(undefined);if(request.action==='commit')setPreview(undefined)}}throw cause}
      await accepted(receipt,request,token);
    });
  }
  async function accepted(receipt:unknown,request:RepositoryConnectionPending,token:number){
    if(request.action==='commit')checkedRepositoryConnectionCommit(receipt,request);else checkedRepositoryConnectionReceipt(receipt,request);
    store.remove(request);
    if(current(token)){setPending(undefined);setPreview(undefined);setNotice(request.action==='commit'?'已确认原定义登记回执。下面显示当前状态；读取仍需独立授权。':request.action==='grant'?'已确认原只读授权。下面显示当前状态，可点击“核验连接”读取真实 HTTP 摘要。':'已确认原撤销命令；下面显示当前状态。');await load(request.input.workspaceId,token)}
  }
  async function inspectPending(){
    if(!pending)return;const frozen=pending;
    await perform(async token=>{
      const receipt:unknown=await window.cbim.call(frozen.action==='commit'?'resources.connection.commitReceipt':'resources.connection.receipt',frozen.action==='commit'?{workspaceId:frozen.input.workspaceId,planId:frozen.input.planId}:{workspaceId:frozen.input.workspaceId,commandId:frozen.input.commandId});
      if(receipt)await accepted(receipt,frozen,token);
      else if(current(token))setError('尚未查到原命令回执。可重试原请求；不会创建新的授权命令。');
    });
  }
  /** 旧实例已退役且服务证明从未受理才解除；查不到回执本身不能推出未提交。 */
  async function resolveUnaccepted(){
    if(!pending)return;const frozen=pending;
    await perform(async token=>{
      const proof=await window.cbim.call('resources.connection.unaccepted',{workspaceId:frozen.input.workspaceId,instanceId:frozen.input.instanceId,action:frozen.action,id:frozen.action==='commit'?frozen.input.planId:frozen.input.commandId});
      if(!checkedRepositoryConnectionUnaccepted(proof,frozen))throw Error('尚不能证明原请求未受理，请保留原请求并查询回执');
      store.remove(frozen);if(current(token)){setPending(undefined);setPreview(undefined);setNotice('已核实旧实例没有受理原请求，可以按当前状态重新操作。');await load(frozen.input.workspaceId,token)}
    });
  }
  async function check(row:Connection){
    if(!list)return;const base=list;
    await perform(async token=>{
      setChecks(value=>{const next={...value};delete next[row.connectorId];return next});
      const value:RepositoryConnectionCheck=await window.cbim.call('resources.connection.check',{...base.identity,connectorId:row.connectorId,expectedGrantRevision:row.grantRevision});
      if(value.identity.workspaceId!==base.identity.workspaceId||value.identity.instanceId!==base.identity.instanceId||value.connectorId!==row.connectorId||value.grantRevision!==row.grantRevision)throw Error('核验回执已过期，请刷新连接状态');
      if(current(token))setChecks(values=>({...values,[row.connectorId]:value}));
    });
  }
  const blocked=busy||!!pending||storageError,sharing=!!list?.sharing;
  return <section className="repository-connections" data-testid="repository-connections">
    <header><div><h2>工作区仓库连接</h2><p>连接当前已共享的资源仓库。允许只读连接后，主 Agent 可按任务读取目录和资料，内容会进入本工作区所选模型的上下文。授权和连接在每轮开始时固定，运行中不会自动换源；撤销会阻止后续读取和迟到结果。</p></div><button disabled={busy} onClick={()=>void refresh()}>刷新连接状态</button></header>
    {!status?.sharing&&<p>请先在设置中启动仓库共享。<button disabled={blocked} onClick={onSettings}>前往仓库设置</button></p>}
    <label>目标工作区<select data-testid="connection-workspace" aria-label="连接目标工作区" disabled={busy} value={workspaceId} onChange={event=>void select(event.target.value)}><option value="">选择已就绪工作区</option>{workspaces.map(workspace=><option key={workspace.id} value={workspace.id} disabled={workspace.state!=='running'}>{workspace.name}{workspace.state!=='running'?'（未就绪）':''}</option>)}</select></label>
    {error&&<p role="alert" data-testid="connection-error">{error}</p>}
    {notice&&<p role="status">{notice}</p>}
    {busy&&<p role="status">正在处理连接请求…</p>}
    {pending&&<div className="repository-connection-preview"><p>原{pending.action==='commit'?'登记':pending.action==='grant'?'授权':'撤销'}命令尚未确认，请先核实结果。原请求已保存在本机，切换页面不会重发。</p><div className="resource-actions"><button disabled={busy} onClick={()=>void inspectPending()}>查询原命令回执</button><button disabled={busy||list?.identity.instanceId!==pending.input.instanceId} onClick={()=>void submit(pending)}>重试原请求</button>{list&&list.identity.instanceId!==pending.input.instanceId&&<button disabled={busy} onClick={()=>void resolveUnaccepted()}>核实未受理并解除</button>}</div>{list&&list.identity.instanceId!==pending.input.instanceId&&<p>工作区实例已更换，旧命令不能重新提交。只有明确证明未受理，才可解除本机待确认记录。</p>}</div>}
    {list&&<>
      <div className="repository-connection-list">{list.connections.map(row=><article className="repository-connection-card" key={row.connectorId} data-testid="connection-card" data-connector-id={row.connectorId}>
        <header><h3>{row.name||row.connectorId}</h3><span className="subtle-badge">{labels[row.status]}</span></header><small>{row.connectorId}</small>{row.repositoryId&&<small>仓库 {row.repositoryId} · 授权版本 {row.grantRevision}</small>}
        <div className="resource-actions">{row.provider==='resource_repository_v1'&&row.definitionHash&&row.repositoryId&&row.status!=='ready'&&<button data-testid="connection-grant" disabled={blocked||!sharing||list.sharing?.repositoryId!==row.repositoryId} onClick={()=>void authorize(row,'grant')}>允许只读连接</button>}
          {row.grant?.enabled&&<button data-testid="connection-revoke" disabled={blocked} onClick={()=>void authorize(row,'revoke')}>撤销访问</button>}
          {row.provider==='resource_repository_v1'&&<button data-testid="connection-check" disabled={blocked||row.status!=='ready'} onClick={()=>void check(row)}>核验连接</button>}
        </div>
        {checks[row.connectorId]&&<div className="repository-connection-result" data-testid="connection-result"><b>HTTP 只读核验通过</b><small>{new Date(checks[row.connectorId].checkedAt).toLocaleString()} · {checks[row.connectorId].itemCount} 项资源</small><small>内容版本 {checks[row.connectorId].revision}</small><ul>{checks[row.connectorId].items.map(item=><li key={item.id}><b>{item.name}</b>{item.summary&&<span> — {item.summary}</span>}</li>)}</ul>{checks[row.connectorId].truncated&&<p>仅显示前 20 项摘要。</p>}<p>这是本次读取结果，未导入资源，也未启动 Agent；后续状态请重新核验。</p></div>}
      </article>)}</div>
      {!list.connections.length&&<p>此工作区尚未登记链接器。</p>}
      <details><summary>登记当前仓库链接器</summary>
        <label>链接器名称<input aria-label="链接器名称" disabled={blocked||!!preview} value={name} maxLength={100} onChange={event=>setName(event.target.value)}/></label>
        <label>链接器标识<input aria-label="链接器标识" disabled={blocked||!!preview} value={slug} maxLength={80} onChange={event=>setSlug(event.target.value)}/></label>
        <p>只保存仓库身份，不保存地址或令牌。已有同名定义会在预览中显示变化。</p>
        <button data-testid="connection-preview" disabled={blocked||!sharing||!!preview||!name.trim()||!/^[A-Za-z0-9_-]+$/.test(slug)} onClick={()=>void prepare()}>预览登记</button>
        {preview&&<div className="repository-connection-preview" data-testid="connection-preview-result"><h3>登记预览</h3><dl><dt>名称</dt><dd>{preview.definition.name}</dd><dt>仓库</dt><dd>{preview.repositoryId}</dd><dt>知识变更</dt><dd>{preview.changes.length} 项</dd></dl>
          {preview.validation.issues.map((issue,index)=><p key={index}>{issue.severity==='error'?'错误':'提示'}：{issue.message}</p>)}
          <details><summary>查看定义变更</summary><pre>{preview.diff}</pre></details><p>登记只修改链接器知识，不授予访问权限。</p>
          <div className="resource-actions"><button data-testid="connection-commit" disabled={blocked||!preview.validation.structural} onClick={()=>void commit()}>确认登记定义</button><button disabled={blocked} onClick={()=>setPreview(undefined)}>取消预览</button></div>
        </div>}
      </details>
    </>}
  </section>;
}
