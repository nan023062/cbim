/**
 * 作用定位：移植 Cindy WorkGroupBlock 的用时和结果；主对话只显示行尾状态，成员详情仍可折叠查看执行轨道。
 * 设计原因：真实动作名称与工具轨道共用，失败／拒绝在折叠外可见；本轮结束不表示整体目标完成。异常影响核实沿真实主会话上下文传递，折叠不查询、不停止任务，也不重放旧调用。
 * 来源：Cindy WorkGroupBlock.tsx，Apache-2.0；许可见 docs/legal。
 */
import type {RunSummary} from '../../bridge/contracts/execution';
import {Icon} from '../components/Icon';
import {toolLabel} from './tool-labels';
import {ToolActivity} from './ToolActivity';
import type {ExecutionRecoveryContext} from '../tasks/useExecutionRecovery';
const labels={running:'正在工作',completed:'本轮结束',cancelled:'已停止',failed:'执行失败',interrupted:'执行中断'};
/** inline 表示调用已在正文展示，不再生成重复轨道或空折叠控件。 */
export function WorkStatus({run,now,recovery,inline=false}:{run:RunSummary;now:number;recovery?:ExecutionRecoveryContext;inline?:boolean}){
  const live=run.status==='running',end=live?now:Date.parse(run.events.at(-1)?.time||'');
  const seconds=Math.max(0,Math.round((end-Date.parse(run.events[0]?.time||''))/1000))||0;
  const duration=seconds>=60?`${Math.floor(seconds/60)}m ${seconds%60}s`:`${seconds}s`;
  const last=run.events.filter(e=>e.type.startsWith('tool.')||e.type==='engine.status'&&!e.data.metric).at(-1);
  const failure=last?.type==='tool.denied'||last?.type==='tool.finished'&&last.data.isError===true;
  const activity=last?.type==='engine.status'?String(last.data.label):last?.type==='tool.proposed'?`等待授权 · ${toolLabel(last.data.name)}`:last?.type==='tool.denied'?`已拒绝 · ${toolLabel(last.data.name)}`:last?.type==='tool.finished'?`${failure?'执行失败':'已返回结果'} · ${toolLabel(last.data.name)}`:last?`正在执行 · ${toolLabel(last.data.name)}`:'正在生成回复';
  const toolCount=new Set(run.events.filter(e=>e.type==='tool.proposed').map(e=>e.data.id)).size;
  if(inline)return <div className="chat-run-status chat-inline-status" role="status"><span className={live?'work-spinner':'work-symbol'}/><span>{live?'正在工作':'已工作'} {duration}</span><span className={'work-outcome '+run.status}>{labels[run.status]}</span>{live&&<span className="inline-activity-label">{activity}</span>}</div>;
  return <div className="work-status-block"><details className="chat-work"><summary className="chat-run-status"><span className={live?'work-spinner':'work-symbol'}>{!live&&<Icon name="knowledge" size={14}/>}</span><span>{live?'正在工作':'已工作'} {duration}</span><span className={'work-outcome '+run.status}>{labels[run.status]}{toolCount?` · ${toolCount} 项操作`:''}</span><Icon name="chevron" size={14}/></summary><div className="chat-work-content"><ToolActivity run={run} recovery={recovery}/></div></details>{(live||failure)&&<div className="work-live-preview" role="status">{live&&!failure&&<span className="work-live-dot"/>}{activity}{failure&&' · 展开工作记录查看原因'}</div>}</div>;
}
