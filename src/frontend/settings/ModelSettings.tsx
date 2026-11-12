/**
 * 作用定位：设置页的自定义供应商、连接表单与模型目录编辑器。
 * 设计原因：提供逐模型视觉能力开关和目录同步；沿用 Cindy 的供应商→连接→模型组织方式；模型获取、加密与测试交给主进程，读取供应商元数据并显式同步已有模型，缺失容量要求填写；界面区分真实容量、工作预算、思考意图和可选 USD 计价，仅保留编辑期间的凭据。
 * 供应商只维护连接与统一模型目录；执行引擎在对话或 Agent 中独立选择，同一模型可供兼容引擎共用。
 * 接口预设、兼容地址和按引擎测试由 ProviderConnections 提供；改接口清空输入中的凭据，保存后才可测试实际配置。
 */
import {useEffect,useState} from 'react';

import type {LlmDefinition,LlmModel,LlmProfile,LlmSettings} from '../../bridge/contracts/models';
import './models.css';
import type {DiscoveredModel} from '../../bridge/contracts/models';
import {ProviderConnections,ProviderConnectionTest,connectionTestNotice} from './ProviderConnections';
const api=window.cbim;
const empty=():LlmDefinition=>({name:'',api:'openai-completions',baseUrl:'',auth:'api-key',models:[],defaultModel:''});
const newModel=(id:string,info?:DiscoveredModel):LlmModel=>({id,name:info?.name||id,enabled:true,contextWindow:info?.contextWindow??0,maxTokens:Math.min(info?.maxOutputTokens??4096,16384,info?.contextWindow??16384),outputLimit:info?.maxOutputTokens,vision:info?.vision,reasoning:info?.reasoning??false});
/** 草稿独立于已保存配置；取消清空凭据，测试连接明确使用已保存版本。 */
export function ModelSettings(){
  const [state,setState]=useState<LlmSettings>(),[editing,setEditing]=useState(false),[id,setId]=useState<string>(),[draft,setDraft]=useState(empty),[key,setKey]=useState('');
  const [modelId,setModelId]=useState(''),[found,setFound]=useState<DiscoveredModel[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[removeId,setRemoveId]=useState<string>();
  useEffect(()=>{void api.call('models.list').then(setState).catch((e:Error)=>setError(e.message))},[]);
  async function perform(work:()=>Promise<void>){setBusy(true);setError('');setNotice('');try{await work()}catch(e:any){setError(e.message)}finally{setBusy(false)}}
  function open(p?:LlmProfile){setId(p?.id);setDraft(p?{name:p.name,api:p.api,baseUrl:p.baseUrl,auth:p.auth,autoDetect:p.autoDetect,alternateConnections:p.alternateConnections?structuredClone(p.alternateConnections):undefined,models:p.models.map(m=>({...m})),defaultModel:p.defaultModel}:empty());setKey('');setFound([]);setModelId('');setEditing(true);setError('');setNotice('')}
  function add(value:string){setDraft(d=>({...d,models:[...d.models,newModel(value,found.find(m=>m.id===value))],defaultModel:d.defaultModel||value}));setModelId('')}
  function updateModel(index:number,patch:Partial<LlmModel>){setDraft(d=>({...d,models:d.models.map((m,i)=>i===index?{...m,...patch}:m)}))}
  // 删除型号同时清理显式接口引用；清空限定列表后需用户重新选择或取消限制，不能静默扩大到全部型号。
  function drop(index:number){setDraft(d=>{
    const models=d.models.filter((_,i)=>i!==index);
    const alternateConnections=d.alternateConnections?.map(connection=>({...connection,modelIds:connection.modelIds?.filter(id=>models.some(model=>model.id===id))}));
    return {...d,models,alternateConnections,defaultModel:models.some(m=>m.id===d.defaultModel)?d.defaultModel:models.find(m=>m.enabled)?.id||''};
  })}
  return <section className="repository-settings model-settings" aria-label="模型供应商">
    <div className="model-heading"><div><h2>模型供应商</h2><p>连接自定义接口，选择大脑使用的默认模型。</p></div><button disabled={busy||editing} onClick={()=>open()}>添加供应商</button></div>
    {error&&<p className="shell-alert" role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
    {!state&&!error&&<p role="status">正在读取模型配置…</p>}
    {state?.profiles.length===0&&!editing&&<p>尚未连接模型供应商。添加后，未指定模型的任务将使用默认模型。</p>}
    {!editing&&state?.profiles.map(p=><div className="model-provider" key={p.id}>
      <div><b>{p.name}</b>{state.selectedId===p.id&&<span className="model-badge">默认</span>}<small>{p.baseUrl}</small><small>{p.models.filter(m=>m.enabled).length} 个已启用模型 · 默认 {p.defaultModel}</small></div>
      <ProviderConnectionTest profile={p} busy={busy} onTest={(modelId,engine)=>void perform(async()=>{const result=await api.call('models.test',{id:p.id,modelId,engine});setNotice(connectionTestNotice(p.name,result))})}/>
      <div className="model-actions"><button disabled={busy} onClick={()=>open(p)}>编辑</button>{state.selectedId!==p.id&&<button disabled={busy} onClick={()=>void perform(async()=>{setState(await api.call('models.select',{id:p.id}))})}>设为默认</button>}<button disabled={busy} onClick={()=>setRemoveId(p.id)}>删除</button></div>
      {removeId===p.id&&<div className="model-delete">删除此供应商及凭据？正在运行的任务不受影响。<button disabled={busy} onClick={()=>void perform(async()=>{setState(await api.call('models.remove',{id:p.id}));setRemoveId(undefined)})}>确认删除</button><button disabled={busy} onClick={()=>setRemoveId(undefined)}>取消</button></div>}
    </div>)}
    {editing&&<form onSubmit={e=>{e.preventDefault();void perform(async()=>{setState(await api.call('models.save',{id,profile:draft,apiKey:key||undefined}));setKey('');setEditing(false);setNotice('供应商已保存。新启动的任务使用新配置，可点击测试连接验证。')})}}>
      <fieldset disabled={busy} className="model-form"><legend>{id?'编辑供应商':'添加自定义供应商'}</legend>
        <label>名称<input required maxLength={80} value={draft.name} onChange={e=>setDraft({...draft,name:e.target.value})} placeholder="我的模型服务"/></label>

        <ProviderConnections value={draft} onChange={next=>{if(next.api!==draft.api||next.baseUrl!==draft.baseUrl||JSON.stringify(next.alternateConnections)!==JSON.stringify(draft.alternateConnections)){setKey('');setFound([])}setDraft(next)}}/>
        <label>鉴权方式<select value={draft.auth} onChange={e=>setDraft({...draft,auth:e.target.value as LlmDefinition['auth']})}><option value="api-key">API Key</option><option value="none">无需鉴权</option></select></label>
        {draft.auth==='api-key'&&<label>API Key<input type="password" autoComplete="new-password" value={key} onChange={e=>setKey(e.target.value)} placeholder={id?'留空保留已保存密钥':'输入 API Key'}/></label>}
        {draft.auth==='api-key'&&!state?.secureStorage&&<p role="alert">系统凭据加密不可用，暂不能保存 API Key。</p>}
        <h3>模型</h3><button type="button" onClick={()=>void perform(async()=>{const {name,api:protocol,baseUrl,auth}=draft;const ids:DiscoveredModel[]=await api.call('models.discoverDetails',{id,connection:{name,api:protocol,baseUrl,auth},apiKey:key||undefined});setFound(ids);setNotice(ids.length?`获取到 ${ids.length} 个模型，选择需要启用的型号。`:'接口没有返回模型，可手动添加。')})}>获取模型列表</button>
        {found.length>0&&<div className="model-found" aria-label="获取到的模型">{found.map(m=>m.id).map(x=><button type="button" key={x} disabled={draft.models.some(m=>m.id===x)} onClick={()=>add(x)}>{draft.models.some(m=>m.id===x)?'已添加':'＋'} {x}</button>)}</div>}
        <div className="model-actions"><input aria-label="手动模型 ID" value={modelId} maxLength={160} onChange={e=>setModelId(e.target.value)} placeholder="手动输入模型 ID"/><button type="button" disabled={!modelId.trim()||draft.models.some(m=>m.id===modelId.trim())} onClick={()=>add(modelId.trim())}>添加模型</button></div>
        <p className="inline-note">图片输入仅在供应商确认支持视觉时开启；未知能力默认关闭，可手动确认或从目录同步。ID 必须与服务端一致。自动读取目录返回的容量资料；缺失项需手动填写，不能把占位值当作模型真实容量。</p>
        {draft.models.map((m,i)=><div className="model-row" key={m.id}><div className="model-heading"><b>{m.id}</b><button type="button" onClick={()=>drop(i)} aria-label={`移除模型 ${m.id}`}>移除</button></div><div className="model-grid"><label>显示名称<input value={m.name} maxLength={160} onChange={e=>updateModel(i,{name:e.target.value})}/></label><label>上下文窗口（供应商真实容量）<input type="number" required min={1024} max={2000000} value={m.contextWindow} onChange={e=>updateModel(i,{contextWindow:Number(e.target.value)})}/></label><label>单次最大输出<input type="number" required min={64} max={Math.min(m.contextWindow,m.outputLimit??2000000)} value={m.maxTokens} onChange={e=>updateModel(i,{maxTokens:Number(e.target.value)})}/></label></div><div className="model-grid">
          <label>供应商输出上限<input type="number" min={1} max={2000000} value={m.outputLimit??''} placeholder="未知" onChange={e=>updateModel(i,{outputLimit:e.target.value?Number(e.target.value):undefined})}/></label><label>思考档位<select disabled={!m.reasoning} value={m.thinkingLevel??'auto'} onChange={e=>updateModel(i,{thinkingLevel:e.target.value==='auto'?undefined:e.target.value as LlmModel['thinkingLevel']})}><option value="auto">默认（medium）</option>{['off','minimal','low','medium','high','xhigh'].map(level=><option key={level} value={level}>{level}</option>)}</select></label>
          <label>工作上下文预算<input type="number" min={1024} max={m.contextWindow} placeholder="使用完整模型容量" value={m.workingContextWindow??''} onChange={e=>updateModel(i,{workingContextWindow:e.target.value?Number(e.target.value):undefined})}/></label>
          <label>自动压缩阈值（%）<input type="number" min={10} max={95} placeholder="Pi 默认；设置工作预算后为 90%" value={m.compactionPercent??''} onChange={e=>updateModel(i,{compactionPercent:e.target.value?Number(e.target.value):undefined})}/></label>
        </div><p className="inline-note">上下文窗口、最大输出请填写供应商真实容量。工作预算只提前触发压缩，不缩小模型容量。Pi 按模型能力应用档位、工作预算和压缩阈值。Claude Code 使用其原生压缩策略；本轮仅应用推理开关和最大输出，工作预算及压缩阈值不覆盖 Claude Code。</p><div className="model-actions"><label><input type="checkbox" checked={m.enabled} onChange={e=>updateModel(i,{enabled:e.target.checked})}/>启用</label><label><input type="checkbox" checked={m.reasoning} onChange={e=>updateModel(i,{reasoning:e.target.checked})}/>支持推理</label><label><input type="checkbox" checked={m.vision===true} onChange={e=>updateModel(i,{vision:e.target.checked})}/>支持图片输入（视觉）</label></div><label><input type="checkbox" checked={!!m.pricing} onChange={e=>updateModel(i,{pricing:e.target.checked?{input:0,output:0,cacheRead:0,cacheWrite:0}:undefined})}/>配置价格（USD / 百万 token；全零表示免费）</label>{m.pricing&&<div className="model-grid">{([['input','输入'],['output','输出'],['cacheRead','缓存读取'],['cacheWrite','缓存写入']] as const).map(([key,label])=><label key={key}>{label}价格<input required type="number" min={0} step="any" value={m.pricing![key]} onChange={e=>updateModel(i,{pricing:{...m.pricing!,[key]:Number(e.target.value)}})}/></label>)}</div>}{m.reasoning&&m.maxTokens<16384&&<p className="model-budget-warning">推理与正文可能共享输出预算；当前上限较低，复杂任务可能在生成正文前耗尽。<button type="button" onClick={()=>updateModel(i,{maxTokens:Math.min(16384,m.contextWindow,m.outputLimit??16384)})}>调整为 16384（不超过上下文窗口）</button></p>}</div>)}
        <p className="inline-note">模型目录未提供容量时必须手动填写，0 表示尚未配置。获取列表不会修改已有模型。</p><button type="button" disabled={!found.length} onClick={()=>{setDraft(d=>({...d,models:d.models.map(m=>{const info=found.find(x=>x.id===m.id);return info?{...m,contextWindow:info.contextWindow??m.contextWindow,outputLimit:info.maxOutputTokens??m.outputLimit,maxTokens:Math.min(m.maxTokens,info.maxOutputTokens??m.maxTokens,info.contextWindow??m.contextWindow),workingContextWindow:m.workingContextWindow?Math.min(m.workingContextWindow,info.contextWindow??m.contextWindow):undefined,vision:info.vision??m.vision,reasoning:info.reasoning??m.reasoning}:m})}));setNotice('已将供应商声明的容量同步到草稿；单次输出预算不会提高，保存后生效。')}}>同步已有模型能力</button><label>供应商默认模型<select required value={draft.defaultModel} onChange={e=>setDraft({...draft,defaultModel:e.target.value})}><option value="">选择默认模型</option>{draft.models.filter(m=>m.enabled).map(m=><option key={m.id} value={m.id}>{m.name||m.id}</option>)}</select></label>
        <div className="model-actions"><button className="solid-button" type="submit" disabled={!draft.models.some(m=>m.enabled&&m.id===draft.defaultModel)}>{busy?'正在处理…':'保存供应商'}</button><button type="button" onClick={()=>{setKey('');setEditing(false);setError('');setNotice('')}}>取消</button></div>
      </fieldset>
    </form>}
    <p className="inline-note">密钥由系统加密保存。连接测试会发送一条短文本请求，可能产生少量费用；不读取工作区知识。</p>
  </section>
}
