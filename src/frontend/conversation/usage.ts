/**
 * 作用定位：从持久化执行事件计算任务时间、已报告 token、生成速度、费用及当前上下文。
 * 设计原因：沿用 Cindy 的生成时间口径；不将工具等待算作 TPS，不把累计消耗当上下文，
 * 缺少计时的旧消息不阻断新消息速度，部分样本明确标注；不将未知价格当免费。纯函数让历史恢复和实时界面使用同一计算规则。
 */
import type {RunSummary} from '../../bridge/contracts/execution';
const number=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
/** 兼容损坏/旧日志时间；仅累计每轮运行区间，不含轮次之间空闲。 */
export function runDuration(run:RunSummary,now:number){
  const start=Date.parse(run.events.find(e=>e.type==='run.started')?.time??'');
  const end=run.status==='running'?now:Date.parse([...run.events].reverse().find(e=>e.type==='run.settled'||e.type==='run.interrupted')?.time??run.events.at(-1)?.time??'');
  return Number.isFinite(start)&&Number.isFinite(end)?Math.max(0,end-start):0;
}
/** 输出包含供应商报告的推理用量；reasoning 为其子集，不能再次加到 output。 */
export function taskUsage(runs:RunSummary[],now:number){
  let input=0,output=0,cacheRead=0,cacheWrite=0,reasoning=0,generationMs=0,cost=0,reports=0,priced=0;
  let timingComplete=true,missingUsage=false;
  let outputForRate=0;
  for(const run of runs){
   const before={input,output,cacheRead,cacheWrite,cost,priced,reports};
   for(const event of run.events){
    if(event.type!=='message')continue;
    const u=event.data.usage as any;if(!u||!number(u.output)){timingComplete=false;missingUsage=true;continue}reports++;
    input+=number(u.input)?u.input:0;output+=u.output;cacheRead+=number(u.cacheRead)?u.cacheRead:0;cacheWrite+=number(u.cacheWrite)?u.cacheWrite:0;reasoning+=number(u.reasoning)?u.reasoning:0;
    if(number(event.data.generationDurationMs)&&event.data.generationDurationMs>0){generationMs+=event.data.generationDurationMs;outputForRate+=u.output}else timingComplete=false;
    if(number(u.cost?.total)&&(event.data.pricingKnown===true||u.cost?.totalFromProvider===true||u.cost.total>0)){cost+=u.cost.total;priced++}
   }
   // 原生差额包含摘要及工具上报用量；替换本轮消息计数，绝不与之重复相加。
   const full=[...run.events].reverse().find(e=>e.type==='engine.status'&&e.data?.metric==='run-usage')?.data;
   const t=full?.tokens as any;
   if(t&&['input','output','cacheRead','cacheWrite'].every(k=>number(t[k]))){
     input=before.input+t.input;output=before.output+t.output;cacheRead=before.cacheRead+t.cacheRead;cacheWrite=before.cacheWrite+t.cacheWrite;
     const known=number(full?.cost)&&(full?.pricingKnown===true||full.cost>0);
     cost=before.cost+(known?full!.cost as number:0);reports=before.reports+1;priced=before.priced+(known?1:0);
   }
  }
  const latest=runs.at(-1),events=latest?.events??[];
  const context=[...events].reverse().find(e=>e.type==='engine.status'&&e.data.metric==='context')?.data;
  const config=[...events].reverse().find(e=>e.type==='engine.status'&&e.data.label==='Pi 运行配置已应用')?.data;
  const capacity=number(context?.contextWindow)?context.contextWindow:number(config?.contextWindow)?config.contextWindow:undefined;
  const used=number(context?.tokens)?context.tokens:undefined;
  return {durationMs:runs.reduce((n,r)=>n+runDuration(r,now),0),input,output,cacheRead,cacheWrite,reasoning,reports,
    total:input+output+cacheRead+cacheWrite,generationMs,ratePartial:!timingComplete,rate:reports&&generationMs>0&&outputForRate>0?outputForRate/(generationMs/1000):undefined,
    cost:priced?cost:undefined,costPartial:priced<reports||missingUsage,capacity,used,percent:capacity&&used!==undefined?used/capacity*100:undefined};
}
/** Cindy 风格紧凑单位；避免四舍五入得到 1000k。 */
export function tokenCount(value:number){for(const [unit,suffix] of [[1e9,'B'],[1e6,'M'],[1e3,'k']] as const)if(value>=unit*0.99995)return (value/unit).toFixed(1)+suffix;return String(Math.round(value))}
export function durationText(ms:number){const s=Math.floor(ms/1000);return s>=3600?`${Math.floor(s/3600)}h ${Math.floor(s%3600/60)}m`:s>=60?`${Math.floor(s/60)}m ${s%60}s`:`${s}s`}
