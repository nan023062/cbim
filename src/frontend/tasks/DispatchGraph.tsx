/**
 * 作用定位：把当前主会话的已提交派发图绘制为可选择的任务节点流程图。
 * 设计原因：HTML 节点保留可读文字和键盘操作，SVG 仅负责有向连线；布局缓存按图身份隔离，状态增量不让节点反复跳位。
 * 职责边界：主 Agent 根只负责调度，正式业务节点属于独立执行 Agent；没有派发图时不把普通对话伪装成业务任务。
 */
import {useId,useMemo,useRef} from 'react';
import type {GraphSnapshot,TaskNode} from '../../bridge/contracts/dispatch';
import {Icon} from '../components/Icon';
import {layoutDispatchGraph,type DispatchGraphLayout} from './graph-layout';
import './task-graph.css';

/** 主会话摘要取自真实运行；它是图根的显示信息，不是派发 TaskNode。 */
export interface DispatchRootView {nodeId:string;name:string;goal:string;status:string;running:boolean;runCount:number;pendingCount:number}
/** 调用方先按工作区/主会话过滤图；本组件不读取后端，也不建立派发关系。 */
export interface DispatchGraphProps {
  /** 缺省时仅绘制真实主会话根，不能解释为创建空派发图。 */
  graph?:GraphSnapshot;
  root:DispatchRootView;
  /** 根使用 nodeId，业务节点使用 taskId，与详情视图的选择约定一致。 */
  selectedTaskId?:string;
  onSelectTask:(id:string)=>void;
}
export const taskStatusLabels:Record<TaskNode['status'],string>={planned:'待安排',queued:'排队中',running:'执行中',waiting:'等待前置',result_ready:'交付待审阅',blocked:'需要处理',failed:'执行失败',cancelled:'已停止',interrupted:'执行中断'};

/** 节点选择只展开详情，不发起任务、改变调度顺序或签发验收。 */
export function DispatchGraph({graph,root,selectedTaskId,onSelectTask}:DispatchGraphProps){
  const viewport=useRef<HTMLDivElement>(null),previous=useRef<{root:string;layout:DispatchGraphLayout}|undefined>(undefined),marker=useId().replace(/[^a-zA-Z0-9_-]/g,'');
  const computed=useMemo(()=>{
    try{const layout=layoutDispatchGraph(graph,root.nodeId,previous.current?.root===root.nodeId?previous.current.layout:undefined);previous.current={root:root.nodeId,layout};return {layout,error:undefined}}
    catch(error){return {layout:undefined,error:error instanceof Error?error.message:'任务图绘制失败，请重新同步'}}
  },[graph,root.nodeId]);
  if(!computed.layout)return <p role="alert" className="task-graph-error">{computed.error}</p>;
  const layout=computed.layout,tasks=new Map(graph?.tasks.map(task=>[task.taskId,task])??[]);
  return <section className="dispatch-graph" aria-label="当前会话任务流程图" data-testid="dispatch-graph">
    <div className="dispatch-graph-toolbar"><span className="graph-legend"><i className="graph-line-sample"/>派发<i className="graph-line-sample dependency"/>依赖</span><button className="graph-home" onClick={()=>viewport.current?.scrollTo({top:0,left:0,behavior:'smooth'})}>定位主 Agent</button></div>
    <div ref={viewport} className="dispatch-graph-viewport" tabIndex={0} aria-label="任务流程图画布，可滚动查看全部节点" data-testid="dispatch-graph-viewport">
      <div className="dispatch-graph-canvas" style={{width:layout.width,height:layout.height}}>
        <svg className="dispatch-graph-lines" width={layout.width} height={layout.height} aria-hidden="true">
          <defs><marker id={'dispatch-arrow-'+marker} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="userSpaceOnUse"><path d="M 1 1 L 7 4 L 1 7" fill="none" stroke="currentColor" strokeWidth="1.5"/></marker></defs>
          {layout.edges.map(({edge,path})=><path key={edge.edgeId} d={path} className={'dispatch-graph-edge '+edge.kind} markerEnd={`url(#dispatch-arrow-${marker})`} data-testid="dispatch-graph-edge" data-kind={edge.kind} data-from={edge.fromNodeId} data-to={edge.toNodeId}/>)}
        </svg>
        {layout.nodes.map(node=>{
          const task=node.taskId?tasks.get(node.taskId):undefined,id=task?.taskId??root.nodeId,status=task?(task.status==='queued'&&task.activeRunId?'正在启动':taskStatusLabels[task.status]):root.status;
          return <button key={node.nodeId} className={'dispatch-node '+(task?'task-node':'root-node')+(selectedTaskId===id?' selected':'')} style={{left:node.x,top:node.y,width:node.width,height:node.height}} onClick={()=>onSelectTask(id)} aria-pressed={selectedTaskId===id} aria-label={`${task?.assignee.name??root.name} · ${task?.goal??root.goal}${task?' · '+task.modules.map(module=>module.name).join('、'):''} · ${status}`} data-testid={task?'dispatch-task-node':'dispatch-root-node'} data-task-id={task?.taskId} data-node-id={node.nodeId} data-status={task?.status}>
            <span className="dispatch-node-top"><span className="dispatch-node-avatar"><Icon name={task?'team':'sparkles'} size={17}/></span><span className="dispatch-node-agent">{task?.assignee.name??root.name}<small>{task?'执行 Agent':'主会话 · 调度根'}</small></span><Icon name="chevron" size={13}/></span>
            <span className="dispatch-node-goal" title={task?.goal??root.goal}>{task?.goal??root.goal}</span>
            {task?<span className="dispatch-node-modules" title={task.modules.map(module=>module.name).join('、')}><Icon name="folder" size={12}/><span>{task.modules.map(module=>module.name).join(' · ')}</span></span>:<span className="dispatch-node-modules">{root.runCount} 次执行 · {root.pendingCount} 条待执行</span>}
            <span className={'dispatch-node-status '+(task?.status??(root.running?'running':''))}><i className={task?.status==='running'||!task&&root.running?'task-state-dot animated':'task-state-dot'}/>{status}</span>
            {task?.waitReason&&<span className="dispatch-node-reason" title={task.waitReason}>{task.waitReason}</span>}
          </button>;
        })}
      </div>
    </div>
    {!graph?.tasks.length&&<p className="dispatch-graph-empty" data-testid="dispatch-empty">当前会话尚未派发成员任务。点击主 Agent 查看已有执行记录；正式派发后，节点和连线会显示在这里。</p>}
    <p className="dispatch-graph-hint">点击节点查看实时详情 · 交付待审阅表示候选结果，尚未业务验收</p>
  </section>;
}
