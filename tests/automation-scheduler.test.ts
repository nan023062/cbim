import {expect,it,vi} from 'vitest';
import type {Bridge} from '../src/bridge/contracts/workspace';
import {randomUUID} from 'node:crypto';
import {AutomationScheduler} from '../src/logic/automation/runtime/scheduler';
import {nextAutomationAt} from '../src/logic/automation/rules/schedule';
import {automationDefinitionSchema,type AutomationDefinition,type AutomationRunner,type AutomationState} from '../src/logic/automation/rules/contracts';

const definition:AutomationDefinition={name:'定时核实',enabled:true,executor:{kind:'main'},moduleIds:[],workflowSelections:[],skillIds:[],prompt:'只读核实项目状态',permission:'read',schedule:{kind:'interval',minutes:5}};
function fixture(){
 let state:AutomationState={version:1,workspaceId:'workspace',jobs:[],runs:[]},now=Date.parse('2026-11-11T00:00:00Z');
 const store={read:async()=>structuredClone(state),write:vi.fn(async(value:AutomationState)=>{state=structuredClone(value)})};
 const runner:AutomationRunner={validate:vi.fn(async()=>{}),start:vi.fn(async(run,_signal,bind)=>{expect(state.runs.find(r=>r.id===run.id)?.status).toBe('starting');const identity={taskId:randomUUID(),runId:randomUUID()};await bind(identity);expect(state.runs.find(r=>r.id===run.id)).toMatchObject(identity);return identity}),inspect:vi.fn(async()=>({status:'running' as const})),stop:vi.fn(async()=>{})};
 const scheduler=new AutomationScheduler(store,runner,()=>now,3600000);
 return {store,runner,scheduler,get state(){return state},advance:(ms:number)=>now+=ms};
}
it('按日程时区计算未来时刻，春季缺失分钟跳过、秋季重复分钟不重复执行',()=>{
 expect(nextAutomationAt({kind:'manual'},Date.now())).toBeUndefined();
 expect(nextAutomationAt({kind:'once',at:'2026-01-01T00:00:00Z'},Date.parse('2026-01-02'))).toBeUndefined();
 expect(nextAutomationAt({kind:'daily',time:'09:00',timezone:'Asia/Shanghai'},Date.parse('2026-11-11T00:00:00Z'))).toBe('2026-11-11T01:00:00.000Z');
 expect(nextAutomationAt({kind:'daily',time:'02:30',timezone:'America/New_York'},Date.parse('2026-03-08T05:00:00Z'))).toBe('2026-03-09T06:30:00.000Z');
 expect(nextAutomationAt({kind:'daily',time:'01:30',timezone:'America/New_York'},Date.parse('2026-11-01T05:30:00Z'),Date.parse('2026-11-01T05:30:00Z'))).toBe('2026-11-02T06:30:00.000Z');
});
it('严格拒绝外部工作区、未知字段、跨模块 Workflow 和无模块岗位任务',()=>{
 expect(automationDefinitionSchema.safeParse({...definition,root:'C:/other'}).success).toBe(false);
 expect(automationDefinitionSchema.safeParse({...definition,workflowSelections:[{moduleId:'other',workflowId:'w'}]}).success).toBe(false);
 expect(automationDefinitionSchema.safeParse({...definition,executor:{kind:'member',memberId:randomUUID()}}).success).toBe(false);
 expect(automationDefinitionSchema.safeParse({...definition,schedule:{kind:'daily',time:'25:30',timezone:'wrong'}}).success).toBe(false);
});
it('固定新定义 ID 与版本保存，冻结运行；启动意图及真实身份先于外部执行，禁止重叠',async()=>{
 const f=fixture();try{
  const id=randomUUID(),job=await f.scheduler.save(id,0,definition);expect(job.id).toBe(id);
  await expect(f.scheduler.save(id,0,definition)).rejects.toMatchObject({code:'AUTOMATION_STALE'});
  const run=await f.scheduler.runNow(id,job.revision);
  await vi.waitFor(()=>expect(f.state.runs[0].status).toBe('running'));
  await expect(f.scheduler.runNow(id,job.revision)).rejects.toMatchObject({code:'AUTOMATION_RUNNING'});
  await f.scheduler.save(id,job.revision,{...definition,prompt:'新的未来任务'});
  expect(f.state.runs[0].definition.prompt).toBe(definition.prompt);expect(run.definitionRevision).toBe(1);
  f.advance(10*60000);await f.scheduler.tick();expect(f.runner.start).toHaveBeenCalledTimes(1);
  vi.mocked(f.runner.inspect).mockResolvedValue({status:'completed'});await f.scheduler.tick();expect(f.state.runs[0].finishedAt).toBeDefined();
  f.advance(5*60000);await f.scheduler.tick();await vi.waitFor(()=>expect(f.runner.start).toHaveBeenCalledTimes(2));
 }finally{await f.scheduler.close()}
});
it('启动后未知结果不重放；暂停停止原任务，删除保留历史',async()=>{
 const f=fixture();try{
  vi.mocked(f.runner.start).mockImplementation(async(_run,_signal,bind)=>{await bind({taskId:'original-task',runId:'original-run'});throw Error('启动回包丢失')});
  vi.mocked(f.runner.inspect).mockResolvedValue({status:'unknown',message:'原结果仍待核实'});
  const job=await f.scheduler.save(undefined,0,definition);await f.scheduler.runNow(job.id,1);
  await vi.waitFor(()=>expect(f.state.runs[0].status).toBe('unknown'));f.advance(10*60000);await f.scheduler.tick();expect(f.runner.start).toHaveBeenCalledTimes(1);
  await f.scheduler.change(job.id,1,'pause');expect(f.runner.stop).toHaveBeenCalledWith('original-task');expect(f.state.runs[0].status).toBe('cancelled');
  await f.scheduler.change(job.id,2,'remove');expect(f.state.jobs).toEqual([]);expect(f.state.runs).toHaveLength(1);
 }finally{await f.scheduler.close()}
});
it('准备中暂停立即传递取消，不持串行锁等待 bind，不会再启动模型',async()=>{
 const f=fixture();let entered=false;try{
  vi.mocked(f.runner.start).mockImplementation(async(_run,signal,bind)=>{entered=true;await new Promise<void>((resolve,reject)=>{signal.addEventListener('abort',()=>reject(signal.reason),{once:true})});await bind({taskId:'must-not-bind',runId:'run'});return {taskId:'must-not-bind',runId:'run'}});
  const job=await f.scheduler.save(undefined,0,definition);await f.scheduler.runNow(job.id,1);await vi.waitFor(()=>expect(entered).toBe(true));
  await f.scheduler.change(job.id,1,'pause');expect(f.state.runs[0]).toMatchObject({status:'cancelled'});expect(f.state.runs[0].taskId).toBeUndefined();expect(f.runner.stop).not.toHaveBeenCalled();
 }finally{await f.scheduler.close()}
});
it('重开跳过过去的计划，无身份启动标中断，有身份只观察原任务',async()=>{
 const f=fixture();try{
  const job=await f.scheduler.save(undefined,0,definition);
  await f.store.write({...f.state,runs:[{id:randomUUID(),automationId:job.id,definitionRevision:1,definition,trigger:'schedule',startedAt:job.createdAt,status:'starting'},{id:randomUUID(),automationId:job.id,definitionRevision:1,definition,trigger:'manual',startedAt:job.createdAt,status:'unknown',taskId:'saved-task',runId:'saved-run'}]});
  f.advance(20*60000);await f.scheduler.initialize();expect(f.state.runs[0].status).toBe('interrupted');expect(f.runner.start).not.toHaveBeenCalled();expect(f.state.jobs[0].nextRunAt).toBe('2026-11-11T00:25:00.000Z');
  await f.scheduler.tick();expect(f.runner.inspect).toHaveBeenCalledWith('saved-task');expect(f.runner.start).not.toHaveBeenCalled();
 }finally{await f.scheduler.close()}
});
it('意图持久化失败时不产生外部执行',async()=>{
 const f=fixture();try{const job=await f.scheduler.save(undefined,0,definition);f.store.write.mockRejectedValueOnce(Error('disk full'));await expect(f.scheduler.runNow(job.id,1)).rejects.toThrow('disk full');expect(f.runner.start).not.toHaveBeenCalled();expect(f.state.runs).toEqual([])}finally{await f.scheduler.close()}
});

// 已迁移自动化协议不能绕过强类型请求；只在 typecheck 检查，不触发执行。
async function contractTypes(bridge:Bridge){
 const state=await bridge.call('automation.list',{workspaceId:'workspace',instanceId:randomUUID()});state.jobs.map(j=>j.revision);
 // @ts-expect-error 必须带完整版本和工作区实例。
 bridge.call('automation.run',{id:randomUUID()});
 // @ts-expect-error 任意工作目录不属于固定工作区协议。
 bridge.call('automation.list',{workspaceId:'workspace',instanceId:randomUUID(),root:'other'});
}
