/**
 * 作用定位：Cindy 风格的输入框上方时间/速度与底部任务价值、上下文占用显示。
 * 设计原因：主行保持轻量，点击展开计量明细；主运行活动与整个目标周期分开显示，等待成员不误报结束。未知计量明确标记，不用累计 token 替代速度。
 */
import {useEffect,useRef,useState,type ReactNode} from 'react';
import type {RunSummary} from '../../bridge/contracts/execution';
import {brainStatus} from './brain-status';
import {Icon} from '../components/Icon';
import {durationText,taskUsage,tokenCount} from './usage';
import './usage.css';
/** 点击固定展开、点击外部或 Escape 关闭；不执行模型或工具调用。 */
function Metric({label,children,title}:{label:ReactNode;children:ReactNode;title:string}){
 const [open,setOpen]=useState(false);const ref=useRef<HTMLDivElement>(null);
 useEffect(()=>{if(!open)return;const outside=(e:PointerEvent)=>{if(!ref.current?.contains(e.target as Node))setOpen(false)};const key=(e:KeyboardEvent)=>{if(e.key==='Escape')setOpen(false)};document.addEventListener('pointerdown',outside);document.addEventListener('keydown',key);return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',key)}},[open]);
 return <div className="usage-metric" ref={ref}><button type="button" className="usage-trigger" title={title} aria-label={title} aria-expanded={open} onClick={()=>setOpen(!open)}>{label}</button>{open&&<div className="usage-popover" role="region" aria-label={title}><strong>{title}</strong>{children}</div>}</div>;
}
/** 主大脑停止流式输出后由会话目标状态接管提示；只影响显示，不改变运行事实或计量。 */
export interface ConversationActivity {label:string;active:boolean;tone:'running'|'warning'|'success'|'neutral'}
export function UsageStatus({runs,now,placement,capacity,waitingApproval=false,activity}:{runs:RunSummary[];now:number;placement:'above'|'footer';capacity?:number;waitingApproval?:boolean;activity?:ConversationActivity}){
 const data=taskUsage(runs,now),latest=runs.at(-1),running=latest?.status==='running';
 const limit=data.capacity??capacity,percent=limit&&data.used!==undefined?data.used/limit*100:undefined;
 const active=running||activity?.active,label=running?brainStatus(latest,waitingApproval):activity?.label??brainStatus(latest);
 if(placement==='above')return <div className="usage-above"><span role="status" data-testid="conversation-activity" className={running?'usage-running':activity?`usage-state-${activity.tone}`:''}>{active&&<span className={waitingApproval?'':'usage-sparkle'}><Icon name={waitingApproval?'hand':'sparkles'} size={15}/></span>}{label}</span><Metric title="任务时间与平均生成速度" label={<>{durationText(data.durationMs)} · {data.rate!==undefined?`${data.rate.toFixed(1)} tok/s${data.ratePartial?'*':''}`:'— tok/s'}</>}><dl><dt>累计工作时间</dt><dd>{durationText(data.durationMs)}</dd><dt>平均输出速度</dt><dd>{data.rate!==undefined?`${data.rate.toFixed(1)} tok/s`:'暂无可靠计时'}</dd><dt>生成耗时</dt><dd>{durationText(data.generationMs)}</dd><dt>输入 / 输出</dt><dd>{tokenCount(data.input)} / {tokenCount(data.output)}</dd><dt>缓存读取 / 写入</dt><dd>{tokenCount(data.cacheRead)} / {tokenCount(data.cacheWrite)}</dd><dt>输出中的推理</dt><dd>{tokenCount(data.reasoning)}</dd><dt>累计已报告 token</dt><dd>{tokenCount(data.total)}</dd></dl><p>任务时间不含轮次间空闲。速度仅用已完成模型请求的生成时间，排除工具和审批等待；* 表示仅统计有可靠计时的请求，旧记录不计入速度；token 在请求结束后更新，推理不重复计数。</p></Metric></div>;
 const money=!data.reports?'尚无用量':data.cost===undefined?'待计价':`$${data.cost.toFixed(4)}${data.costPartial?' + 未计价部分':''}`;
 return <div className="usage-footer"><Metric title="本任务价值" label={<>本任务价值 {money}</>}><p className="usage-value">{money}</p><p>按各轮模型价格或供应商报告的费用累计，单位 USD。按配置价格计算的数值是估算，不代表实际账单或业务收益。</p>{data.cost===undefined&&<p>在“设置 → 模型供应商 → 编辑”填写每百万 token 价格；历史未计价记录不会用新价格追溯改写。</p>}</Metric><Metric title="上下文使用与总上限" label={<><svg viewBox="0 0 20 20" className="usage-ring" aria-hidden="true"><circle cx="10" cy="10" r="7" className="usage-ring-track"/><circle cx="10" cy="10" r="7" pathLength="100" strokeDasharray={`${Math.min(100,percent??0)} 100`} transform="rotate(-90 10 10)"/></svg>{percent===undefined?'待更新':`${Math.round(percent)}%`}</>}><dl><dt>当前上下文（估计）</dt><dd>{data.used===undefined?'待模型更新':tokenCount(data.used)}</dd><dt>总上下文上限</dt><dd>{limit?`${tokenCount(limit)} token`:'未知'}</dd><dt>占用比例</dt><dd>{percent===undefined?'—':`${percent.toFixed(1)}%`}</dd></dl><p>使用 Pi 原生上下文估计，不是累计消耗。压缩后估计可能暂不可用；上限来自本轮实际模型容量。</p></Metric></div>;
}
