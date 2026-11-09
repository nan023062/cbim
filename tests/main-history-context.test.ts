import {test,expect,vi} from 'vitest';
import path from 'node:path';
import {WorkspaceExecutionManager} from '../src/backend/scheduler-engine/execution/execution-manager';
import type {KnowledgeWorkspace} from '../src/backend/core/knowledge/ports';
import type {RunSummary} from '../src/backend/core/brain/types';
import type {RunStorage} from '../src/backend/core/brain/storage';

function fixture(){
  const context={initialRunId:'initial',nativeSessionId:'680739fc-53ab-4099-bc8d-273f3c5c4a37',excludedRunIds:['old']};
  const owner={entry:{id:'workspace',path:'C:/fixture'},paths:{project:()=> 'C:/data'},assert:()=>{}} as unknown as KnowledgeWorkspace;
  const records=new Map<string,RunSummary|Error>();
  const summary=(runId:string,parent?:string,time='2026-11-07T00:00:00.000Z'):RunSummary=>({
    task:{taskId:'root',workspaceId:'workspace',root:'C:/fixture',mode:'chat',agentId:'cbim:main',goal:'核实影响',moduleIds:[],acceptance:[]},runId,status:'completed',acceptance:'not_evaluated',sessionFile:'native',unresolvedTools:[],logIntegrity:{partialTail:false},
    events:[{version:1,seq:1,workspaceId:'workspace',taskId:'root',runId,time,type:'run.started',data:parent?{resumeFrom:parent}:{freshMain:{nativeSessionId:context.nativeSessionId,excludedRunIds:context.excludedRunIds}}},{version:1,seq:2,workspaceId:'workspace',taskId:'root',runId,time,type:'session.bound',data:{sessionId:context.nativeSessionId}}],
  });
  const read=vi.fn(async(directory:string)=>{const item=records.get(path.basename(directory));if(item instanceof Error)throw item;if(!item)throw Object.assign(Error('missing'),{code:'ENOENT'});return structuredClone(item)});
  const storage={list:async()=>[...records.keys()],read,reserveTask:vi.fn(),createJournal:vi.fn()} as unknown as RunStorage;
  const manager=new WorkspaceExecutionManager(owner,storage,vi.fn());
  manager.attachCollaboration({busy:()=>false,settled:()=>{},stop:async()=>{},recoveryContext:async()=>context});
  records.set('old',Object.assign(Error('old private bad bytes'),{code:'RUN_LOG_INVALID'}));records.set('initial',summary('initial',undefined,'2026-11-07T00:01:00.000Z'));records.set('latest',summary('latest','initial'));
  return {manager,records,summary,read,context};
}

test('新上下文按可靠链排序，旧坏记录只展示问题且不参与执行预检',async()=>{
  const f=fixture();expect((await f.manager.thread('root')).map(run=>run.runId)).toEqual(['initial','latest']);
  expect(f.read.mock.calls.map(([dir])=>path.basename(dir))).toEqual(['initial','latest']);f.read.mockClear();
  const view=await f.manager.threadView('root');expect(view.resumeRunId).toBe('latest');expect(view.issues).toEqual([{runId:'old',code:'RUN_LOG_INVALID',message:expect.not.stringContaining('private')}]);
  expect(f.read).toHaveBeenCalledTimes(3); // 全历史展示只读一次，不再次回读全部当前日志。
});
test('当前最新日志损坏不能退回较早可读头',async()=>{
  const f=fixture();f.records.set('latest',Object.assign(Error('damaged'),{code:'RUN_LOG_INVALID'}));
  await expect(f.manager.thread('root')).rejects.toThrow();expect((await f.manager.threadView('root')).resumeRunId).toBeUndefined();
});
test('新初始意图没有日志时不能借旧历史或后续孤立日志续接',async()=>{
  const f=fixture();f.records.delete('initial');
  await expect(f.manager.thread('root')).rejects.toMatchObject({code:'MAIN_CONTEXT_INCOMPLETE'});expect((await f.manager.threadView('root')).resumeRunId).toBeUndefined();
});
test('未被明确排除的孤立运行与原生身份冲突均阻断',async()=>{
  const f=fixture();f.records.set('orphan',f.summary('orphan','missing'));
  await expect(f.manager.thread('root')).rejects.toMatchObject({code:'MAIN_CONTEXT_IDENTITY'});f.records.delete('orphan');
  const latest=f.summary('latest','initial');latest.events[1].data.sessionId='other-native';f.records.set('latest',latest);
  expect((await f.manager.threadView('root')).resumeRunId).toBeUndefined();
});
test('尾行不完整可展示但不能续接，原始摘要不被修复',async()=>{
  const f=fixture(),latest=f.summary('latest','initial');latest.logIntegrity={partialTail:true};f.records.set('latest',latest);
  const view=await f.manager.threadView('root');expect(view.runs).toHaveLength(2);expect(view.resumeRunId).toBeUndefined();expect(view.issues.some(issue=>issue.code==='RUN_LOG_INCOMPLETE')).toBe(true);expect(latest.logIntegrity.partialTail).toBe(true);
});
test('分叉不能按时间选择任一分支',async()=>{
  const f=fixture();f.records.set('branch',f.summary('branch','initial','2026-11-07T00:02:00.000Z'));
  await expect(f.manager.thread('root')).rejects.toMatchObject({code:'MAIN_CONTEXT_IDENTITY'});
});
