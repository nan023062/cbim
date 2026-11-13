/**
 * 目录归属：logic/execution/rules/execution；运行协议与计量。
 * 作用定位：从大脑持久化事件计算单轮用量、任务累计消耗、生成速度和当前上下文，供全局监管与界面共用。
 * 设计原因：计量属于执行事实，不能依赖前端；原生轮次汇总覆盖消息计数，推理不重复累计，未知费用不伪装为免费。
 * 职责边界：这里只读取事件，不去重、不读取磁盘、不改变执行状态；调用方按 runId/seq 去重后传入同轮事件。
 */
import type {RunSummary,StoredEvent} from './types';

/** 单轮累计用量；失败或取消不抹除已经报告的消耗。 */
export interface RunUsage {
  input:number;
  output:number;
  cacheRead:number;
  cacheWrite:number;
  /** 推理是 output 的子集，仅展示，不再次加入 total。 */
  reasoning:number;
  /** 累计已报告 token，包含缓存读写；不是当前上下文占用。 */
  total:number;
  /** 已知部分的美元金额；undefined 表示没有可信计价，零必须有明确免费依据。 */
  cost?:number;
  /** 有用量缺失或价格未知时为 true，已知金额只能视作部分费用。 */
  costPartial:boolean;
  /** 区分“未收到用量”和“供应商明确上报零消耗”。 */
  usageReported:boolean;
}

interface RunMeasurement {
  usage:RunUsage;
  reports:number;
  generationMs:number;
  outputForRate:number;
  timingComplete:boolean;
}

const number=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
const record=(value:unknown):Record<string,unknown>|undefined=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:undefined;

/** 消息用于计时；完整原生汇总用于计量，两者不能相加，也不能用工具耗时稀释生成速度。 */
function measureRun(events:readonly StoredEvent[]):RunMeasurement {
  let input=0,output=0,cacheRead=0,cacheWrite=0,reasoning=0,cost=0,reports=0,priced=0;
  let generationMs=0,outputForRate=0,timingComplete=true,missingUsage=false;
  for(const event of events){
    if(event.type!=='message')continue;
    const data=event.data??{},usage=record(data.usage);
    if(!usage||!number(usage.output)){timingComplete=false;missingUsage=true;continue}
    reports++;
    input+=number(usage.input)?usage.input:0;
    output+=usage.output;
    cacheRead+=number(usage.cacheRead)?usage.cacheRead:0;
    cacheWrite+=number(usage.cacheWrite)?usage.cacheWrite:0;
    reasoning+=number(usage.reasoning)?Math.min(usage.reasoning,usage.output):0;
    if(number(data.generationDurationMs)&&data.generationDurationMs>0){
      generationMs+=data.generationDurationMs;outputForRate+=usage.output;
    }else timingComplete=false;
    const price=record(usage.cost);
    if(price&&number(price.total)&&(data.pricingKnown===true||price.totalFromProvider===true||price.total>0)){
      cost+=price.total;priced++;
    }
  }
  // 最后一个有效汇总包含压缩等额外消耗；损坏的后续记录不能清空已经确认的计量。
  for(let i=events.length-1;i>=0;i--){
    const event=events[i],data=event.data??{};
    if(event.type!=='engine.status'||data.metric!=='run-usage')continue;
    const tokens=record(data.tokens);
    if(!tokens||!number(tokens.input)||!number(tokens.output)||!number(tokens.cacheRead)||!number(tokens.cacheWrite))continue;
    input=tokens.input;output=tokens.output;cacheRead=tokens.cacheRead;cacheWrite=tokens.cacheWrite;
    reasoning=Math.min(number(tokens.reasoning)?tokens.reasoning:reasoning,output);
    const known=number(data.cost)&&(data.pricingKnown===true||data.totalFromProvider===true||data.cost>0);
    cost=known?data.cost as number:0;reports=1;priced=known?1:0;missingUsage=false;
    break;
  }
  return {
    usage:{input,output,cacheRead,cacheWrite,reasoning,total:input+output+cacheRead+cacheWrite,
      cost:priced?cost:undefined,costPartial:priced<reports||missingUsage,usageReported:reports>0},
    reports,generationMs,outputForRate,timingComplete
  };
}

/**
 * 计算单个 runId 的已报告消耗，不要求运行成功或已经结束。
 * 调用方负责事件去重与跨轮求和；完整 run-usage 以覆盖方式收口，context 指标不参与累计消耗。
 */
export function runUsage(events:readonly StoredEvent[]):RunUsage {return measureRun(events).usage}

/** 兼容损坏/旧日志时间；仅累计每轮运行区间，不含轮次之间空闲。 */
export function runDuration(run:RunSummary,now:number){
  const start=Date.parse(run.events.find(e=>e.type==='run.started')?.time??'');
  const end=run.status==='running'?now:Date.parse([...run.events].reverse().find(e=>e.type==='run.settled'||e.type==='run.interrupted')?.time??run.events.at(-1)?.time??'');
  return Number.isFinite(start)&&Number.isFinite(end)?Math.max(0,end-start):0;
}

/** 任务展示口径：逐轮求和，速度只用有计时的消息；当前上下文只取最后一轮，压缩后允许下降或清空。 */
export function taskUsage(runs:readonly RunSummary[],now:number){
  let input=0,output=0,cacheRead=0,cacheWrite=0,reasoning=0,cost=0,reports=0,pricedRuns=0;
  let generationMs=0,outputForRate=0,timingComplete=true,costPartial=false;
  for(const run of runs){
    const measured=measureRun(run.events),usage=measured.usage;
    input+=usage.input;output+=usage.output;cacheRead+=usage.cacheRead;cacheWrite+=usage.cacheWrite;reasoning+=usage.reasoning;
    reports+=measured.reports;generationMs+=measured.generationMs;outputForRate+=measured.outputForRate;
    timingComplete&&=measured.timingComplete;costPartial||=usage.costPartial;
    if(usage.cost!==undefined){cost+=usage.cost;pricedRuns++}
  }
  const events=runs.at(-1)?.events??[];
  const context=[...events].reverse().find(e=>e.type==='engine.status'&&e.data?.metric==='context')?.data;
  const config=[...events].reverse().find(e=>e.type==='engine.status'&&e.data?.label==='Pi 运行配置已应用')?.data;
  const capacity=number(context?.contextWindow)?context.contextWindow:number(config?.contextWindow)?config.contextWindow:undefined;
  const used=number(context?.tokens)?context.tokens:undefined;
  return {durationMs:runs.reduce((n,r)=>n+runDuration(r,now),0),input,output,cacheRead,cacheWrite,reasoning,reports,
    total:input+output+cacheRead+cacheWrite,generationMs,ratePartial:!timingComplete,
    rate:reports&&generationMs>0&&outputForRate>0?outputForRate/(generationMs/1000):undefined,
    cost:pricedRuns?cost:undefined,costPartial,capacity,used,percent:capacity&&used!==undefined?used/capacity*100:undefined};
}

/** Cindy 风格紧凑单位；避免四舍五入得到 1000k。 */
export function tokenCount(value:number){for(const [unit,suffix] of [[1e9,'B'],[1e6,'M'],[1e3,'k']] as const)if(value>=unit*0.99995)return (value/unit).toFixed(1)+suffix;return String(Math.round(value))}
/** 毫秒转换为任务时长文本；与轮次空闲时间无关。 */
export function durationText(ms:number){const s=Math.floor(ms/1000);return s>=3600?`${Math.floor(s/3600)}h ${Math.floor(s%3600/60)}m`:s>=60?`${Math.floor(s/60)}m ${s%60}s`:`${s}s`}
