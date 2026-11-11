/**
 * 作用定位：显示知识校验和索引任务的实际状态与结果。
 * 设计原因：只呈现已有工具任务生命周期，不根据状态猜测业务 Workflow 的内部执行步骤。
 */
import {useState} from 'react';
import type {WorkspaceView} from '../../bridge/contracts/workspace';
import {Icon} from '../components/Icon';
import {Empty} from '../components/Empty';
import {stateLabels} from '../components/state-labels';
export function FlowView({workspace,run,cancel}:{workspace:WorkspaceView;run:(name:string)=>void;cancel:(id:string)=>void}){
  const [chosen,setChosen]=useState('');const task=workspace.tasks.find(t=>t.id===chosen)||[...workspace.tasks].reverse()[0];
  const finished=task?.state==='completed';
  return <div className="view-page"><div className="view-heading"><div><p className="overline">任务 / 实时状态</p><h1>任务流程</h1><p>跟进 {workspace.name} 的实际工具任务。</p></div><button className="solid-button" onClick={()=>run('validate')}><Icon name="check" size={16}/>检查工作区知识</button></div>
    {!task?<Empty icon="flow" title="还没有运行中的任务"><p>运行一次知识检查，查看任务状态与执行结果。</p><p>AI 工作流调度尚未接入。</p></Empty>:<><div className="graph-toolbar"><label>当前任务 <select aria-label="当前任务" value={task.id} onChange={e=>setChosen(e.target.value)}>{[...workspace.tasks].reverse().map((t,i)=><option key={t.id} value={t.id}>{t.name==='validate'?'知识检查':'索引重建'} · {stateLabels[t.state]} · {workspace.tasks.length-i}</option>)}</select></label><span className={'live-state '+task.state}><i/>{stateLabels[task.state]||task.state}</span>{task.state==='running'&&<button onClick={()=>cancel(task.id)}>取消任务</button>}</div><div className="flow-canvas"><div className="flow-step done"><span className="step-icon"><Icon name="check"/></span><div><small>01 · 已提交</small><b>{task.name==='validate'?'检查工作区知识':'校验并重建索引'}</b><p>{workspace.name}</p></div></div><div className="flow-line"/><div className={'flow-step '+task.state}><span className="step-icon"><Icon name={finished?'check':task.state==='running'?'clock':'close'}/></span><div><small>02 · {stateLabels[task.state]}</small><b>{finished?'执行完成':task.state==='running'?'正在执行':'执行已结束'}</b><p>{task.error||task.progress}</p></div></div><div className="flow-line dashed"/><div className="flow-step review"><span className="step-icon"><Icon name="team"/></span><div><small>03 · 人工阶段</small><b>团队 review</b><p>架构与业务语义需要团队确认，未自动执行。</p></div></div></div>{task.result!==undefined&&<details className="result-detail"><summary>查看实际执行结果</summary><pre>{JSON.stringify(task.result,null,2)}</pre></details>}<p className="view-footnote">状态每 1.2 秒更新。此图展示工具任务生命周期，不推断未提供的内部执行步骤。</p></>}
  </div>
}
