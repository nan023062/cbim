/**
 * 作用定位：默认总览全部已安装引擎，选择具体引擎后集中展示能力、模型、版本、实时状态及包管理操作。
 * 设计原因：所有引擎操作留在自己的详情页；轮询只读本机状态，切页停止轮询，不自动检查远端或重复安装。
 * 状态边界：AsyncGeneration 只隔离迟到快照；提交冻结的候选摘要与 revision；在途刷新不能覆盖操作回执，已有安装与缓存归后端持久化。
 */
import {useCallback,useEffect,useRef,useState} from 'react';
import {modelRoleChoices,supportedEngines,providerSupportsEngine,engineDescriptor,type LoopEngine,type EnginePackageSettings} from '../../bridge/contracts/engines';
import type {LlmSettings} from '../../bridge/contracts/models';
import {AsyncGeneration} from '../foundations/utility';
import {EngineOverview} from './EngineOverview';
const api=window.cbim;

/** 页面只持有选择和只读快照；安装、依赖锁、原子启用与缓存复用继续由 EnginePackages 管理。 */
export function EngineSettings({active=true}:{active?:boolean}){
  const [selected,setSelected]=useState<LoopEngine|'all'>('all'),[state,setState]=useState<EnginePackageSettings>(),[models,setModels]=useState<LlmSettings>();
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[readError,setReadError]=useState(''),[notice,setNotice]=useState('');
  const alive=useRef(false),reading=useRef<symbol|undefined>(undefined),acting=useRef(false),generation=useRef(new AsyncGeneration());
  const reload=useCallback(async(includeModels=false)=>{
    if(reading.current===generation.current.capture())return;
    const request=generation.current.capture();reading.current=request;
    try{
      const [engines,models]=await Promise.all([api.call('engines.settings'),includeModels?api.call('models.list'):Promise.resolve(undefined)]);
      if(alive.current&&generation.current.isCurrent(request)){setState(engines);setReadError('');if(models)setModels(models)}
    }catch(error:any){if(alive.current&&generation.current.isCurrent(request))setReadError(error.message)}
    finally{if(reading.current===request)reading.current=undefined}
  },[]);
  useEffect(()=>{
    if(!active)return;alive.current=true;
    void reload(true);
    const timer=setInterval(()=>{if(!document.hidden)void reload()},1000);
    return()=>{alive.current=false;generation.current.advance();clearInterval(timer)};
  },[active,reload]);
  async function perform(work:()=>Promise<EnginePackageSettings>,message:string){
    if(acting.current)return;acting.current=true;generation.current.advance();setBusy(true);setError('');setNotice('');
    try{const next=await work();generation.current.advance();setState(next);setNotice(message)}
    catch(error:any){generation.current.advance();setError(error.message)}
    finally{acting.current=false;setBusy(false)}
  }
  const descriptor=selected!=='all'?engineDescriptor(selected):undefined,item=state?.items.find(item=>item.kind===selected);
  const available=descriptor&&models?models.profiles.flatMap(profile=>profile.models.filter(model=>model.enabled&&providerSupportsEngine(descriptor.id,profile,model.id)).map(model=>profile.name+' / '+(model.name||model.id))):[];
  const installed=!!item?.active,sameVersion=!!item?.active&&item.active.identity===item.candidate?.identity;
  const preparing=!!item?.preparing,blocked=busy||preparing||!state?.managed;
  return <section className="repository-settings" aria-label="引擎能力支持列表">
    <label className="engine-selector">选择引擎<select aria-label="选择引擎" value={selected} disabled={busy} onChange={event=>{setSelected(event.target.value as LoopEngine|'all');setError('');setNotice('')}}>
      <option value="all">全部引擎</option>{supportedEngines.map(engine=><option key={engine.id} value={engine.id}>{engine.label}</option>)}
    </select></label>
    {!state&&!error&&!readError&&<p role="status">正在读取引擎列表…</p>}
    {selected==='all'&&<EngineOverview state={state} onSelect={kind=>{setSelected(kind);setError('');setNotice('')}}/>}
    {descriptor&&<article className="model-row engine-detail" aria-label={descriptor.label+' 引擎详情'}>
      <h2>{descriptor.label}</h2><p>擅长：{descriptor.businessTypes.join('、')}</p>
      <p>支持模型范围：{descriptor.supportedApis.join(' / ')} 兼容的生成模型</p>
      <p>当前可用模型：{available.length?available.join('、'):'尚未配置兼容模型'}</p>
      {(descriptor.additionalModelRoles??[]).map(role=><p key={role.id}>{role.label}：{role.kind==='embedding'?'向量模型':'生成模型'}{role.required?'（必填）':'（可选）'}{role.modelIds?' · '+role.modelIds.join('、'):''} · 当前可用：{models?(modelRoleChoices(role,models).map(model=>model.label).join('、')||'尚未配置'):'正在读取'}</p>)}
      {state&&!state.managed&&<p>源码开发模式：当前使用源码引擎，正式包管理在安装版中可用。</p>}
      {item&&<>
        <p>安装状态：{installed?'已安装':'未安装'} · {item.enabled?'已启用':'已停用'}{item.references?' · 使用中 '+item.references:''}</p>
        <p>当前版本：{item.active?.version??'未安装'} · 可用版本：{item.candidate?.version??'暂无兼容版本'}</p>
        {preparing&&<div role="status"><p>正在准备并校验{item.preparation?' '+item.preparation.version:''}{item.preparation?.progress!==undefined?' · '+Math.round(item.preparation.progress)+'%':''}</p><progress aria-label="引擎准备进度" max={100} value={item.preparation?.progress}/></div>}
        {item.error&&<p role="alert">{item.error}</p>}
        <div className="model-actions">
          <button disabled={blocked||!item.candidate||sameVersion&&!item.error} onClick={()=>void perform(()=>api.call('engines.install',{kind:descriptor.id,revision:state!.revision,identity:item.candidate!.identity}),'引擎已准备并启用；正在运行的任务保持原版本。')}>{item.error?'重试准备':sameVersion?'已安装当前版本':installed?'更新引擎':item.installed.some(value=>value.identity===item.candidate?.identity)?'从缓存添加':'下载并安装'}</button>
          <button disabled={blocked||item.enabled&&item.references>0} onClick={()=>void perform(()=>api.call('engines.configure',{kind:descriptor.id,revision:state!.revision,action:item.enabled?'disable':'enable'}),item.enabled?'引擎已停用。':'引擎已启用。')}>{item.enabled?'停用':'启用'}</button>
          <button disabled={blocked||!installed||item.references>0} onClick={()=>void perform(()=>api.call('engines.configure',{kind:descriptor.id,revision:state!.revision,action:'remove'}),'引擎已移除，模型设置和历史缓存已保留。')}>移除引擎</button>
          <button disabled={blocked} onClick={()=>void perform(()=>api.call('engines.check'),'已检查官方引擎版本，尚未安装更新。')}>检查引擎更新</button>
          <button disabled={busy} onClick={()=>{setError('');void reload(true)}}>刷新状态</button>
        </div>
        <details><summary>版本与依赖详情</summary>
          <p>运行库版本：{item.active?.nativeVersion??'未安装'} · 历史包：{item.installed.length}</p>
          {item.installed.map(value=><p key={value.identity}>已缓存 {value.version}{value.identity===item.active?.identity?' · 当前使用':''}</p>)}
          {item.active?.dependencies.map(ref=><p key={ref.kind}>{ref.kind} · {ref.identity.slice(0,12)}</p>)}
          <p>更新 CBIM 会保留引擎安装和缓存；相同制品校验后直接复用。移除不删除模型、历史会话和缓存；运行中或被其他启用引擎依赖时不能移除。</p>
        </details>
      </>}
      {notice&&<p role="status">{notice}</p>}
    </article>}
    {(error||readError)&&<p role="alert">{error||readError}</p>}
  </section>;
}
