/**
 * 作用定位：配置应用级 Agent 并发上限，展示真实准入占用与等待数量。
 * 设计原因：设置通过版本化可靠提交才生效；实时数量独立于表单草稿，降低额度不终止现有任务，也不把容量等同费用预算。
 */
import {useEffect,useState} from 'react';
import {admissionPolicySchema,type AdmissionPolicy} from '../../bridge/contracts/admission';
import {useAdmission,refreshAdmission} from '../tasks/useAdmission';
import '../tasks/admission.css';

/** 本机设置不需要模型参与，不能从页面直接领取或释放执行名额。 */
export function AdmissionSettings(){
  const feed=useAdmission(),[policy,setPolicy]=useState<AdmissionPolicy>(),[value,setValue]=useState('4'),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  useEffect(()=>{let alive=true;void window.cbim.call('admission.settings').then(raw=>{const saved=admissionPolicySchema.parse(raw);if(alive){setPolicy(saved);setValue(String(saved.maxConcurrentRuns))}}).catch((error:Error)=>{if(alive)setError(error.message)});return()=>{alive=false}},[]);
  async function reload(){setBusy(true);setError('');setNotice('');try{const next=admissionPolicySchema.parse(await window.cbim.call('admission.settings'));setPolicy(next);setValue(String(next.maxConcurrentRuns));await refreshAdmission()}catch(error){setError(error instanceof Error?error.message:String(error))}finally{setBusy(false)}}
  async function save(){
    if(!policy||busy)return;setBusy(true);setError('');setNotice('');
    try{const next=admissionPolicySchema.parse(await window.cbim.call('admission.configure',{revision:policy.revision,maxConcurrentRuns:Number(value)}));setPolicy(next);setValue(String(next.maxConcurrentRuns));setNotice('已保存。新运行按此上限领取名额；正在执行的任务继续运行。');await refreshAdmission()}
    catch(error){setError(error instanceof Error?error.message:String(error))}finally{setBusy(false)}
  }
  const count=Number(value),valid=/^\d+$/.test(value)&&Number.isInteger(count)&&count>=1&&count<=32;
  return <section className="repository-settings" aria-label="运行并发设置" data-testid="admission-settings"><h2>运行并发</h2>
    <p>所有工作区的主 Agent 和执行 Agent 共用运行名额。默认最多 4 个；等待中的任务不占名额，也不会调用模型。</p>
    {feed.data&&<div className="admission-settings-counts" role="status" data-testid="admission-counts"><span>已占用 {feed.data.occupied.length} / 上限 {feed.data.policy.maxConcurrentRuns}</span><span>等待 {feed.data.waiting.length} 项</span>{feed.data.occupied.length>feed.data.policy.maxConcurrentRuns&&<span>上限已降低，等待现有运行结束后再准入。</span>}</div>}
    {feed.error&&<p role="status">占用状态暂时无法同步，上次数据可能已过期。</p>}
    <div className="admission-settings-form"><label>全局并发上限<input aria-label="全局并发上限" type="number" min={1} max={32} step={1} disabled={!policy||busy} value={value} onChange={event=>setValue(event.target.value)}/></label><button className="solid-button" disabled={!policy||busy||!valid} onClick={()=>void save()}>保存并发设置</button><button disabled={busy} onClick={()=>void reload()}>刷新设置</button></div>
    <p>降低上限不会中止正在运行的任务。已受理协作会等待后继续；新对话名额不足时保留草稿，由你再次发送。此设置不限制 token 或费用。</p>
    {notice&&<p role="status">{notice}</p>}{error&&<p role="alert">{error}</p>}
  </section>;
}
