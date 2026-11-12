import {test,expect,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {WorkspaceExecutionManager} from '../src/backend/scheduler-engine/conversation/execution-manager';
import {FileRunStorage} from '../src/backend/main/run-storage/run-storage';
import type {KnowledgeWorkspace} from '../src/backend/core/knowledge/ports';
import type {ReplanRequest,ReplanReceipt} from '../src/backend/core/tasks/scope-replan';

function barrier(){let resolve!:()=>void;const promise=new Promise<void>(accept=>{resolve=accept});return {promise,resolve}}
async function fixture(stage:'preflight'|'factory'|'accepted'){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-replan-race-')),entered=barrier(),release=barrier();
  const owner={entry:{id:'workspace',path:directory},paths:{project:()=>directory},assert:()=>{}} as unknown as KnowledgeWorkspace;
  const input:ReplanRequest={workspaceId:'workspace',rootSessionId:'root',commandId:randomUUID(),source:{inspectionScopeId:'inspection',expectedBasis:'a'.repeat(64)},input:{message:'根据核实结果重新实现'},options:{provider:'fixture',model:'fixture',profileId:randomUUID(),permission:'ask'}};
  let receipt:ReplanReceipt|undefined;
  const acceptReplan=vi.fn(async(request:ReplanRequest,_task:unknown,context:{runId:string})=>{
    receipt={workspaceId:request.workspaceId,rootSessionId:request.rootSessionId,scopeId:request.commandId,scopeStatus:'active',replan:{replanId:request.commandId,acceptedAt:new Date().toISOString(),operation:'business_replan',source:{inspectionScopeId:request.source.inspectionScopeId,expectedBasis:request.source.expectedBasis,proof:{inspectionGoalRevision:2,inspectionPlanRevision:1,reviewRunId:'inspection-review',knowledgeRevision:'knowledge',sourceScopeId:'old-scope',sourceTaskId:'old-task',sourceReportBasis:'b'.repeat(64),evidenceDigest:'c'.repeat(64),requiredModules:[{moduleId:'module',name:'Module'}],inheritedHuman:[]}},input:request.input,options:request.options,runId:context.runId}};
  });
  const startFreshMain=vi.fn(async(task:any,message:string,control:any)=>{
    if(stage!=='accepted')throw Error('stopped attempt must not start runtime');
    expect(task.agentId).toBe('cbim:main');expect(task.taskId).toBe(input.rootSessionId);expect(task.goal).toBe(input.input.message);expect(message).toContain('cbim_goal_inspect');
    await control.beforeRun({runId:'new-business-run',nativeSessionId:randomUUID(),excludedRunIds:['old-run']});
    throw Error('engine failed after durable acceptance');
  });
  const runtimeClose=vi.fn(async()=>{}),startFailed=vi.fn(async()=>{}),starting=vi.fn(async()=>{});
  const factory=vi.fn(async()=>{if(stage==='factory'){entered.resolve();await release.promise}return {runtime:{startFreshMain,close:runtimeClose}} as never});
  const manager=new WorkspaceExecutionManager(owner,new FileRunStorage(),factory);
  manager.attachCollaboration({busy:()=>false,settled:()=>{},stop:async()=>{},starting,startFailed,replanReceipt:async()=>receipt,replanPreflight:async()=>{if(stage==='preflight'){entered.resolve();await release.promise}},acceptReplan});
  return {manager,input,entered,release,factory,startFreshMain,runtimeClose,acceptReplan,startFailed,starting,cleanup:async()=>{release.resolve();await manager.close();await fs.rm(directory,{recursive:true,force:true})}};
}

test.each(['preflight','factory'] as const)('业务重规划%s等待时停止，不在停止后启动或受理新业务',async stage=>{
  const f=await fixture(stage);try{
    const pending=f.manager.replanExecution(f.input);void pending.catch(()=>{});await f.entered.promise;
    const stopped=f.manager.stop('root');f.release.resolve();await expect(pending).rejects.toMatchObject({code:'COLLABORATION_STOPPED'});await stopped;
    expect(f.startFreshMain).not.toHaveBeenCalled();expect(f.acceptReplan).not.toHaveBeenCalled();if(stage==='preflight')expect(f.factory).not.toHaveBeenCalled();
  }finally{await f.cleanup()}
});
test('业务预检期间关闭，不装配新引擎或消费意图',async()=>{
  const f=await fixture('preflight');try{
    const pending=f.manager.replanExecution(f.input);void pending.catch(()=>{});await f.entered.promise;
    const closing=f.manager.close();f.release.resolve();await expect(pending).rejects.toMatchObject({code:'COLLABORATION_STOPPED'});await closing;
    expect(f.factory).not.toHaveBeenCalled();expect(f.acceptReplan).not.toHaveBeenCalled();
  }finally{await f.cleanup()}
});
test('业务请求排队尚未预检时停止，不能在稍后轮到它时启动',async()=>{
  const f=await fixture('preflight');try{
    const blocker=f.manager.replanExecution({...f.input,rootSessionId:'blocker',commandId:randomUUID()});void blocker.catch(()=>{});await f.entered.promise;
    const pending=f.manager.replanExecution(f.input);void pending.catch(()=>{});const stopped=f.manager.stop('root');f.release.resolve();
    await expect(blocker).rejects.toThrow('stopped attempt must not start runtime');await expect(pending).rejects.toMatchObject({code:'COLLABORATION_STOPPED'});await stopped;
    expect(f.factory).toHaveBeenCalledTimes(1);expect(f.acceptReplan).not.toHaveBeenCalled();
  }finally{await f.cleanup()}
});
test('已受理后引擎失败仍返回原回执；重复命令不再装配，变更目标或权限被拒绝',async()=>{
  const f=await fixture('accepted');try{
    const receipt=await f.manager.replanExecution(f.input);expect(receipt.replan.runId).toBe('new-business-run');
    expect(f.startFailed).toHaveBeenCalledTimes(1);expect(f.starting).not.toHaveBeenCalled();expect(f.acceptReplan).toHaveBeenCalledTimes(1);
    expect(await f.manager.replanExecution(f.input)).toEqual(receipt);expect(f.factory).toHaveBeenCalledTimes(1);
    await expect(f.manager.replanExecution({...f.input,input:{message:'different'}})).rejects.toMatchObject({code:'REPLAN_COMMAND_CONFLICT'});
    await expect(f.manager.replanExecution({...f.input,options:{...f.input.options,permission:'execute'}})).rejects.toMatchObject({code:'REPLAN_COMMAND_CONFLICT'});
    await expect(f.manager.replanExecution({...f.input,source:{...f.input.source,expectedBasis:'b'.repeat(64)}})).rejects.toMatchObject({code:'REPLAN_COMMAND_CONFLICT'});
    expect(f.factory).toHaveBeenCalledTimes(1);
  }finally{await f.cleanup()}
});
