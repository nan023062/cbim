import {expect,vi} from 'vitest';
import path from 'node:path';
import {fixture} from './helpers';
import {recursivePauseProvider} from './recursive-pause-provider';
import {seedMemberCheckpoint} from './member-checkpoint-fixture';
import {Application} from '../src/bridge/server/application';
import {Paths} from '../src/logic/workspace/service/paths';
import {FileDispatchStore} from '../src/logic/dispatch/storage/dispatch-store';
import {FileRunStorage} from '../src/logic/execution/storage/run-storage';
import type {PendingQuestion} from '../src/logic/tools/rules/questions';

/** 真实应用集成夹具：仅本地模型输出可控，不构造运行状态或旧派工图。 */
export async function prepareRecursivePause(secondQuestion=false,holdAfterAnswer=false,invalidateByCommand=false){
 const f=await fixture(),provider=await recursivePauseProvider(holdAfterAnswer,secondQuestion,false,invalidateByCommand);let app=f.app;
 try{
  const {entry}=await seedMemberCheckpoint(app,f.a,provider);
  const start=await app.Dispatch('loop.chat',{id:entry.id,message:'依次完成 A、B、C，在 A 原调用内暂停求助',options:{permission:'execute',turnTimeoutMs:60000}});
  const until=async(check:()=>Promise<void>|void)=>{await vi.waitFor(async()=>{if(provider.errors.length)return;await check()},{timeout:30000,interval:30});expect(provider.errors).toEqual([])};
  const questions=()=>app.Dispatch('loop.questions',{id:entry.id,taskId:start.taskId}) as Promise<PendingQuestion[]>;
  const question=async(previous?:string)=>{await until(async()=>{const q=await questions();expect(q).toHaveLength(1);if(previous)expect(q[0].id).not.toBe(previous)});return (await questions())[0]};
  const first=await question();
  const answer=(q:PendingQuestion)=>app.Dispatch('loop.answerQuestion',{id:entry.id,taskId:start.taskId,questionId:q.id,answers:[{option:0,other:'继续同一次调用，不重放写入'}]});
  const state=()=>app.Workspace(entry.id).dispatchStore.Read();
  const persistedState=async()=>{const store=new FileDispatchStore(path.join(f.user,entry.id,'dispatch'),entry.id);try{return await store.Read()}finally{await store.Close()}};
  const binding=(await state()).agentBusinessRuns![0].binding;
  const directory=path.join(f.user,entry.id,'loop-engine/tasks',binding.taskId,binding.runId);
  const child=()=>new FileRunStorage().Read(directory);
  const stop=()=>app.Dispatch('loop.stop',{id:entry.id,taskId:start.taskId});
  const reopen=async()=>{await app.Shutdown();app=new Application(new Paths(f.user,path.resolve('.')));await app.Init()};
  return {f,provider,entry,start,first,binding,directory,until,questions,question,answer,state,persistedState,child,stop,reopen,get app(){return app},cleanup:async()=>{provider.releaseContinuation();await app.Shutdown();await provider.close();await f.cleanup()}};
 }catch(error){provider.releaseContinuation();await app.Shutdown();await provider.close();await f.cleanup();throw error}
}
