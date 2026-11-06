/**
 * 作用定位：移植 Cindy WorkGroupBlock 的折叠标题、运行旋转图标、实时活动预览和执行轨道。
 * 设计原因：只投影真实执行事件；上下文计量不覆盖当前活动文案，折叠不停止任务，等待批准与执行中分开呈现。
 * 来源：Cindy WorkGroupBlock.tsx，Apache-2.0；许可见 docs/legal。
 */
import type {RunSummary} from '../../bridge/contracts/execution';
import {Icon} from '../components/Icon';
import {ToolActivity} from './ToolActivity';
const labels={running:'正在工作',completed:'本轮完成',cancelled:'已停止',failed:'执行失败',interrupted:'执行中断'};
export function WorkStatus({run,now}:{run:RunSummary;now:number}){
  const live=run.status==='running',end=live?now:Date.parse(run.events.at(-1)?.time||'');
  const seconds=Math.max(0,Math.round((end-Date.parse(run.events[0]?.time||''))/1000))||0;
  const duration=seconds>=60?`${Math.floor(seconds/60)}m ${seconds%60}s`:`${seconds}s`;
  const last=run.events.filter(e=>e.type.startsWith('tool.')||e.type==='engine.status'&&!e.data.metric).at(-1);
  const activity=last?.type==='engine.status'?String(last.data.label):last?.type==='tool.proposed'?`等待授权 · ${last.data.name}`:last?.type==='tool.denied'?`已拒绝 · ${last.data.name}`:last?.type==='tool.finished'?`已返回结果 · ${last.data.name}`:last?`正在执行 · ${last.data.name}`:'正在生成回复';
  const toolCount=new Set(run.events.filter(e=>e.type==='tool.proposed').map(e=>e.data.id)).size;
  return <div className="work-status-block"><details className="chat-work"><summary className="chat-run-status"><span className={live?'work-spinner':'work-symbol'}>{!live&&<Icon name="knowledge" size={14}/>}</span><span>{live?'正在工作':'已工作'} {duration}</span><span className={'work-outcome '+run.status}>{labels[run.status]}{toolCount?` · ${toolCount} 项操作`:''}</span><Icon name="chevron" size={14}/></summary><div className="chat-work-content"><ToolActivity run={run}/></div></details>{live&&<div className="work-live-preview" role="status"><span className="work-live-dot"/>{activity}</div>}</div>;
}
