/**
 * 作用定位：官方引擎能力列表，展示业务专长、支持接口、已配置可用模型和包管理状态。
 * 设计原因：引擎与模型独立设置；用户显式发现/安装/停用/移除，不开放自定义包来源，操作提交显示的准确候选与 revision。
 */
import {useEffect,useState} from 'react';
import {supportedEngines,providerSupportsEngine,engineDescriptor,type LoopEngine,type EnginePackageSettings} from '../../bridge/contracts/engines';
import type {LlmSettings} from '../../bridge/contracts/models';
const api=window.cbim;
export function EngineSettings(){
  const [state,setState]=useState<EnginePackageSettings>(),[models,setModels]=useState<LlmSettings>(),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  async function reload(){const [engines,models]=await Promise.all([api.call('engines.settings'),api.call('models.list')]);setState(engines);setModels(models)}
  useEffect(()=>{let alive=true;void Promise.all([api.call('engines.settings'),api.call('models.list')]).then(([engines,models])=>{if(alive){setState(engines);setModels(models)}}).catch(error=>{if(alive)setError(error.message)});return ()=>{alive=false}},[]);
  async function perform(work:()=>Promise<void>,message:string){setBusy(true);setError('');setNotice('');try{await work();setNotice(message)}catch(error:any){setError(error.message);await reload().catch(()=>{})}finally{setBusy(false)}}
  async function install(kind:LoopEngine){const item=state?.items.find(value=>value.kind===kind);if(!state||!item?.candidate)return;setState(await api.call('engines.install',{kind,revision:state.revision,identity:item.candidate.identity}))}
  async function configure(kind:LoopEngine,action:'enable'|'disable'|'remove'){if(!state)return;setState(await api.call('engines.configure',{kind,revision:state.revision,action}))}
  return <section className="repository-settings" aria-label="引擎能力支持列表"><h2>引擎能力支持列表</h2><p>选择适合业务的官方引擎，再为 Agent 配置可用模型。引擎更新仅影响后续启动的运行。</p>
    <div className="model-actions"><button disabled={busy||!state?.managed} onClick={()=>void perform(async()=>setState(await api.call('engines.check')),'已检查官方引擎版本，尚未安装更新。')}>检查引擎更新</button><button disabled={busy} onClick={()=>void perform(reload,'引擎和可用模型列表已刷新。')}>刷新引擎列表</button></div>
    {!state&&!error&&<p role="status">正在读取引擎列表…</p>}{state&&!state.managed&&<p>源码开发模式：当前使用源码引擎，正式包管理在安装版中可用。</p>}
    {supportedEngines.map(value=>{const descriptor=engineDescriptor(value.id),item=state?.items.find(item=>item.kind===value.id),available=models?.profiles.flatMap(profile=>profile.models.filter(model=>model.enabled&&providerSupportsEngine(value.id,profile,model.id)).map(model=>profile.name+' / '+(model.name||model.id)))??[];return <article className="model-row" key={value.id}><h3>{value.label}</h3><p>擅长：{value.businessTypes.join('、')}</p><p>支持模型范围：{value.supportedApis.join(' / ')} 兼容的生成模型</p><p>当前可用模型：{available.length?available.join('、'):'尚未配置兼容模型'}</p>{(descriptor.additionalModelRoles??[]).map(role=><p key={role.id}>{role.label}：{role.kind==='embedding'?'向量模型':'生成模型'}{role.required?'（必填）':'（可选）'}{role.modelIds?' · '+role.modelIds.join('、'):''}</p>)}
      {item&&<><p>状态：{item.preparing?'正在准备':!item.enabled?'已停用':item.active?'已安装':'未安装'}{item.active?' · 当前 '+item.active.version:''}{item.candidate&&item.candidate.identity!==item.active?.identity?' · 可用 '+item.candidate.version:''}{item.references?' · 使用中 '+item.references:''}</p>{item.error&&<p role="alert">{item.error}</p>}
        <div className="model-actions"><button disabled={busy||item.preparing||!item.candidate} onClick={()=>void perform(()=>install(value.id),'引擎已准备并启用；正在运行的任务保持原版本。')}>{item.error?'重试安装':item.active?item.candidate?.identity!==item.active.identity?'更新引擎':'校验并启用':'添加引擎'}</button><button disabled={busy||item.preparing||item.enabled&&item.references>0} onClick={()=>void perform(()=>configure(value.id,item.enabled?'disable':'enable'),item.enabled?'引擎已停用。':'引擎已启用。')}>{item.enabled?'停用':'启用'}</button><button disabled={busy||item.preparing||!item.active||item.references>0} onClick={()=>void perform(()=>configure(value.id,'remove'),'引擎已移除，模型设置和历史缓存已保留。')}>移除引擎</button></div>
        <details><summary>版本与依赖详情</summary><p>上游版本：{item.active?.nativeVersion??'未安装'} · 历史包：{item.installed.length}</p>{item.active?.dependencies.map(ref=><p key={ref.kind}>{ref.kind} · {ref.identity.slice(0,12)}</p>)}<p>移除不会删除模型凭据或历史会话；被运行或其它启用引擎依赖时不能移除。</p></details></>}
    </article>})}
    {notice&&<p role="status">{notice}</p>}{error&&<p role="alert">{error}</p>}
  </section>;
}
