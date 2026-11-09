/**
 * 自动任务显示领取时的重核说明，不调用长期岗位对照接口冒充已登记成员。
 * 作用定位：在选中任务详情中显式核实当前负责人、能力和模型与原派发是否一致。
 * 设计原因：查询不随流式事件轮询，不消费检查点或改变执行；控制器按完整任务版本隔离迟到响应，历史与当前观察分别呈现。
 */
import {useEffect,useState} from 'react';
import type {TaskNode} from '../../bridge/contracts/dispatch';
import {OwnerInspectionController,ownerInspectionKey,ownerTaskView} from './owner-execution-state';
import './owner-execution.css';

const explanations={matching:'本次读取与原派发绑定一致；实际领取仍须重新核实。',changed:'当前岗位、责任或配置版本已变化；原任务和历史结果保持不变。',unavailable:'当前负责人配置存在缺口，不能据此新领取任务。',legacy:'这是旧任务，没有可信岗位绑定；当前查询不会自动补绑。'};
/** 只接收调用方已经核对会话的 TaskNode；本组件无执行、采纳或重派按钮。 */
export function OwnerExecutionInspection({task}:{task:TaskNode}){
  const [controller]=useState(()=>new OwnerInspectionController(task,input=>window.cbim.call('dispatch.ownerInspect',input))),[,refresh]=useState(0);
  const key=ownerInspectionKey(task),state=controller.snapshot;
  useEffect(()=>controller.subscribe(()=>refresh(value=>value+1)),[controller]);
  useEffect(()=>{controller.observe(task)},[controller,key]);
  useEffect(()=>()=>controller.dispose(),[controller]);
  const shown=state.key===key?state:undefined;
  if(task.fallbackBinding)return <p className="owner-execution-muted">自动兜底的模块、模型和负责人状态会在实际领取时重新核实；后续登记的负责人不会覆盖这份历史。</p>;
  if(ownerTaskView(task).kind==='invalid')return null;
  return <section className="owner-execution-current" aria-label="当前负责人核实" data-testid="owner-current-inspection">
    <button disabled={!!shown?.loading} onClick={()=>{controller.observe(task);void controller.inspect()}} data-testid="owner-inspect-current">{shown?.loading?'正在核实…':'核实当前负责人配置'}</button>
    <p className="owner-execution-muted">只读取本任务涉及的岗位、模块及公开模型配置；不会启动模型、采纳配置或移交任务。</p>
    {shown?.error&&<p className="owner-execution-warning" role="alert">{shown.error}；如有旧报告，仅保留当时观察。</p>}
    {shown?.view&&<div data-testid="owner-current-result" data-comparison={shown.view.comparison}>
      <p className={shown.view.comparison==='matching'?'owner-execution-muted':'owner-execution-warning'}>{explanations[shown.view.comparison]}</p>
      {shown.view.issues.map((issue,index)=><p key={index} className="owner-execution-warning">{issue}</p>)}
      <p className="owner-execution-muted">核实于 {new Date(shown.view.report.current.checkedAt).toLocaleString()}；此后配置变化不会自动刷新本报告。</p>
      <details><summary>本次读取的当前岗位</summary>{shown.view.report.current.groups.map((group,index)=><div key={index}><p>{group.memberName??'没有可核实的岗位'}{group.selection&&<> · 第 {group.selection.expectedMemberRevision} 版</>}</p><code>{group.memberId}</code><p>{group.moduleIds.join('、')}</p></div>)}</details>
    </div>}
  </section>;
}
