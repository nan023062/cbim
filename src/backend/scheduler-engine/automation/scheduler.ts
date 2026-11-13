/**
 * 作用定位：工作区自动化的串行定义修改、定时触发和执行状态维护。
 * 设计原因：先保存 starting 意图，再通过窄执行端口启动；异步启动不占串行锁，bind 能保存原任务且暂停可取消。每项最多一个未结执行；重启跳过错过的时刻，不重放启动。
 */
import {randomUUID} from 'node:crypto';
import {fail} from '../../../core/errors';
import {automationDefinitionSchema,type AutomationDefinition,type AutomationJob,type AutomationRun,type AutomationState,type AutomationStorage,type AutomationRunner} from '../../../logic/automation/rules/contracts';
import {nextAutomationAt} from '../../../logic/automation/rules/schedule';
const active=(run:AutomationRun)=>['starting','running','waiting','unknown'].includes(run.status);
const message=(error:unknown)=>(error instanceof Error?error.message:String(error)).slice(0,4000);
export class AutomationScheduler {
 private tail:Promise<unknown>=Promise.resolve();private timer?:ReturnType<typeof setInterval>;private closing=false;private pending=new Map<string,{controller:AbortController;promise:Promise<void>}>();
 constructor(private readonly store:AutomationStorage,private readonly runner:AutomationRunner,private readonly now:()=>number=Date.now,private readonly pollMs=5000){}
 private serial<T>(work:()=>Promise<T>):Promise<T>{const result=this.tail.then(work);this.tail=result.catch(()=>{});return result}
 private assert(){if(this.closing)fail('AUTOMATION_CLOSED','自动化服务已关闭')}
 private stamp(){return new Date(this.now()).toISOString()}
 private watch(){if(!this.timer&&!this.closing){this.timer=setInterval(()=>{void this.tick().catch(()=>{/* 原记录保留，下一次只核实同一执行，不重放 */})},this.pollMs);this.timer.unref?.()}}
 /** 只恢复记录和下一未来时刻；有原任务的记录继续只读观察，无身份的中断意图不重发。 */
 async initialize(){await this.serial(async()=>{let changed=false;const state=await this.store.read();for(const run of state.runs)if(active(run)&&!run.taskId){run.status='interrupted';run.finishedAt=this.stamp();run.message='应用退出前启动未完成，未自动重放';changed=true}
  for(const job of state.jobs)if(job.nextRunAt&&Date.parse(job.nextRunAt)<=this.now()){job.nextRunAt=nextAutomationAt(job.definition.schedule,this.now());if(job.definition.schedule.kind==='once')job.definition.enabled=false;changed=true}
  if(changed)await this.store.write(state);if(state.jobs.some(job=>job.definition.enabled)||state.runs.some(active))this.watch();
 })}
 list(){return this.serial(()=>this.store.read())}
 /** 定义版本 CAS；修改只影响未来执行，不修改已冻结的运行。 */
 save(id:string|undefined,expectedRevision:number,definition:AutomationDefinition){return this.serial(async()=>{this.assert();definition=automationDefinitionSchema.parse(definition);await this.runner.validate(definition);const state=await this.store.read(),old=state.jobs.find(job=>job.id===id);if(old?expectedRevision!==old.revision:expectedRevision!==0)fail('AUTOMATION_STALE','自动化已变化，请刷新后保存');if(!old&&state.jobs.length>=100)fail('AUTOMATION_LIMIT','每个工作区最多保存 100 项自动化');if(definition.schedule.kind==='once'&&definition.enabled&&Date.parse(definition.schedule.at)<=this.now())fail('AUTOMATION_TIME','一次执行时间必须在将来');
  const job:AutomationJob={id:old?.id??id??randomUUID(),workspaceId:state.workspaceId,revision:(old?.revision??0)+1,definition,createdAt:old?.createdAt??this.stamp(),updatedAt:this.stamp(),nextRunAt:definition.enabled?nextAutomationAt(definition.schedule,this.now()):undefined};state.jobs=old?state.jobs.map(item=>item.id===job.id?job:item):[...state.jobs,job];await this.store.write(state);if(job.definition.enabled)this.watch();return structuredClone(job);
 })}
 private job(state:AutomationState,id:string,revision:number){const job=state.jobs.find(job=>job.id===id);if(!job||job.revision!==revision)fail('AUTOMATION_STALE','自动化不存在或版本已变化，请刷新');return job}
 /** 手动运行也先持久意图；返回已受理记录，不等待模型或声称业务已完成。 */
 runNow(id:string,revision:number){return this.serial(async()=>{this.assert();const state=await this.store.read(),job=this.job(state,id,revision);if(state.runs.some(run=>run.automationId===id&&active(run)))fail('AUTOMATION_RUNNING','该自动化仍有运行或未知结果，请先核实原任务');return this.claim(state,job,'manual')})}
 private async claim(state:AutomationState,job:AutomationJob,trigger:AutomationRun['trigger']){
  const run:AutomationRun={id:randomUUID(),automationId:job.id,definitionRevision:job.revision,definition:structuredClone(job.definition),trigger,startedAt:this.stamp(),status:'starting'};
  state.runs.push(run);while(state.runs.length>500){const index=state.runs.findIndex(item=>!active(item));if(index<0)fail('AUTOMATION_LIMIT','未结运行过多');state.runs.splice(index,1)}
  if(trigger==='schedule'){job.nextRunAt=nextAutomationAt(job.definition.schedule,this.now(),this.now());if(job.definition.schedule.kind==='once')job.definition.enabled=false}
  await this.store.write(state);const controller=new AbortController();
  // 下一微任务才进入 runner，当前意图保存先完成；bind 使用独立串行轮次，避免锁内回调自锁。
  const promise=Promise.resolve().then(()=>this.launch(run,controller)).finally(()=>this.pending.delete(run.id));this.pending.set(run.id,{controller,promise});void promise.catch(()=>{});this.watch();return structuredClone(run);
 }
 private async updateRun(id:string,change:(run:AutomationRun)=>void){return this.serial(async()=>{const state=await this.store.read(),run=state.runs.find(item=>item.id===id);if(run){change(run);await this.store.write(state)}})}
 private async launch(run:AutomationRun,controller:AbortController){
  try{controller.signal.throwIfAborted();await this.runner.validate(run.definition);controller.signal.throwIfAborted();const result=await this.runner.start(run,controller.signal,async identity=>{controller.signal.throwIfAborted();await this.updateRun(run.id,value=>{value.taskId=identity.taskId;value.runId=identity.runId});controller.signal.throwIfAborted()});await this.updateRun(run.id,value=>{if(value.taskId!==result.taskId||value.runId!==result.runId)fail('AUTOMATION_RECEIPT','启动回执与持久任务身份不一致');value.status='running'});
  }catch(error){await this.updateRun(run.id,value=>{value.status=controller.signal.aborted?'cancelled':value.taskId?'unknown':'failed';value.message=message(error);if(value.status!=='unknown')value.finishedAt=this.stamp()})}
 }
 /** 不重入 tick；原任务未结时跳过新计划时刻，避免积压补跑或重叠。 */
 tick(){return this.serial(async()=>{if(this.closing)return;const state=await this.store.read();let changed=false;
  for(const run of state.runs)if(active(run)&&run.taskId&&!this.pending.has(run.id)){try{const current=await this.runner.inspect(run.taskId);if(current.status!==run.status||(current.message!==undefined&&current.message!==run.message)){run.status=current.status;if(current.message!==undefined)run.message=current.message;if(!active(run))run.finishedAt=this.stamp();changed=true}}catch(error){if(run.status!=='unknown'){run.status='unknown';run.message=message(error);changed=true}}}
  if(changed)await this.store.write(state);
  for(const job of state.jobs)if(job.definition.enabled&&job.nextRunAt&&Date.parse(job.nextRunAt)<=this.now()){
   if(state.runs.some(run=>run.automationId===job.id&&active(run))){job.nextRunAt=nextAutomationAt(job.definition.schedule,this.now(),this.now());if(job.definition.schedule.kind==='once')job.definition.enabled=false;await this.store.write(state);continue}
   await this.claim(state,job,'schedule');
  }
 })}
 /** 暂停/删除先冻结未来触发并中止准备，再停止已绑定的真实任务；停止失败保留原记录。 */
 async change(id:string,revision:number,action:'pause'|'resume'|'remove'){
  const targets=await this.serial(async()=>{this.assert();const state=await this.store.read(),job=this.job(state,id,revision);if(action==='resume'){job.definition.enabled=true;job.nextRunAt=nextAutomationAt(job.definition.schedule,this.now());if(job.definition.schedule.kind==='once'&&!job.nextRunAt)fail('AUTOMATION_TIME','一次执行时间已过期，请编辑时间');job.revision++;job.updatedAt=this.stamp();await this.store.write(state);this.watch();return []}
   const targets=state.runs.filter(run=>run.automationId===id&&active(run));for(const run of targets)this.pending.get(run.id)?.controller.abort(Error('用户暂停或删除自动化'));if(action==='remove')state.jobs=state.jobs.filter(item=>item.id!==id);else{job.definition.enabled=false;job.nextRunAt=undefined;job.revision++;job.updatedAt=this.stamp()}await this.store.write(state);return targets;
  });for(const run of targets){await this.pending.get(run.id)?.promise;const current=(await this.list()).runs.find(item=>item.id===run.id);if(current?.taskId)await this.runner.stop(current.taskId);await this.updateRun(run.id,value=>{value.status='cancelled';value.finishedAt=this.stamp()})}return this.list();
 }
 /** 关闭不删除定义或重跑；先取消所有启动并等待，再让宿主按原顺序关闭会话与存储。 */
 async close(){this.closing=true;if(this.timer)clearInterval(this.timer);this.timer=undefined;for(const value of this.pending.values())value.controller.abort(Error('工作区自动化正在关闭'));await Promise.allSettled([...this.pending.values()].map(value=>value.promise));await this.tail}
}
