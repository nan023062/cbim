import {test,expect,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {WorkspaceExecutionManager} from '../src/logic/conversation/runtime/execution-manager';
import {FileRunStorage} from '../src/backend/main/run-storage/run-storage';
import type {KnowledgeWorkspace} from '../src/logic/knowledge/rules/ports';
import type {RecoveryRequest} from '../src/logic/tasks/rules/scope-recovery';

function barrier(){let resolve!:()=>void;const promise=new Promise<void>(accept=>{resolve=accept});return {promise,resolve}}
async function fixture(stage:'preflight'|'factory'){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-recovery-race-')),entered=barrier(),release=barrier();
  const owner={entry:{id:'workspace',path:directory},paths:{project:()=>directory},assert:()=>{}} as unknown as KnowledgeWorkspace;
  const startFreshMain=vi.fn(async()=>{throw Error('stopped attempt must not start runtime')}),runtimeClose=vi.fn(async()=>{}),acceptRecovery=vi.fn(async()=>{});
  const factory=vi.fn(async()=>{if(stage==='factory'){entered.resolve();await release.promise}return {runtime:{startFreshMain,close:runtimeClose}} as never});
  const manager=new WorkspaceExecutionManager(owner,new FileRunStorage(),factory);
  manager.attachCollaboration({busy:()=>false,settled:()=>{},stop:async()=>{},recoveryReceipt:async()=>undefined,recoveryPreflight:async()=>{if(stage==='preflight'){entered.resolve();await release.promise}},acceptRecovery});
  const input:RecoveryRequest={workspaceId:'workspace',rootSessionId:'root',commandId:randomUUID(),source:{scopeId:'old-scope',taskId:'old-task',reportBasis:'a'.repeat(64)},operation:'inspect_effects',observation:{text:'观察到异常'},input:{message:'只读核实'},options:{provider:'fixture',model:'fixture',profileId:randomUUID(),permission:'read'}};
  return {manager,input,entered,release,factory,startFreshMain,runtimeClose,acceptRecovery,cleanup:async()=>{release.resolve();await manager.close();await fs.rm(directory,{recursive:true,force:true})}};
}
test.each(['preflight','factory'] as const)('新核实%s等待期间停止，不在停止后重新启动或消费意图',async stage=>{
  const f=await fixture(stage);try{
    const pending=f.manager.recoverExecution(f.input);void pending.catch(()=>{});await f.entered.promise;
    const stopped=f.manager.stop('root');f.release.resolve();await expect(pending).rejects.toMatchObject({code:'COLLABORATION_STOPPED'});await stopped;
    expect(f.startFreshMain).not.toHaveBeenCalled();expect(f.acceptRecovery).not.toHaveBeenCalled();if(stage==='preflight')expect(f.factory).not.toHaveBeenCalled();
  }finally{await f.cleanup()}
});
test('预检等待期间关闭应用，不装配新核实引擎或消费意图',async()=>{
  const f=await fixture('preflight');try{
    const pending=f.manager.recoverExecution(f.input);void pending.catch(()=>{});await f.entered.promise;
    const closing=f.manager.close();f.release.resolve();await expect(pending).rejects.toMatchObject({code:'COLLABORATION_STOPPED'});await closing;
    expect(f.factory).not.toHaveBeenCalled();expect(f.acceptRecovery).not.toHaveBeenCalled();
  }finally{await f.cleanup()}
});
test('核实请求已进入串行队列但尚未开始时停止，也不能在轮到它之后新启动',async()=>{
  const f=await fixture('preflight');try{
    const blocker=f.manager.recoverExecution({...f.input,rootSessionId:'blocker',commandId:randomUUID()});void blocker.catch(()=>{});await f.entered.promise;
    const pending=f.manager.recoverExecution(f.input);void pending.catch(()=>{});const stopped=f.manager.stop('root');f.release.resolve();
    await expect(blocker).rejects.toThrow('stopped attempt must not start runtime');await expect(pending).rejects.toMatchObject({code:'COLLABORATION_STOPPED'});await stopped;
    expect(f.factory).toHaveBeenCalledTimes(1);expect(f.acceptRecovery).not.toHaveBeenCalled();
  }finally{await f.cleanup()}
});
