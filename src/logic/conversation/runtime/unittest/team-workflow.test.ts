// logic/conversation/runtime: module-owned integration coverage; keep the original scenario and cleanup semantics.
import {required} from '../../../../../scripts/unittest/support/assertions';
import {FileRunStorage} from '../../../execution/storage/run-storage';
import {it,expect} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fixture} from '../../../application/unittest/support/helpers';
import {seedTeam} from '../../../knowledge/service/unittest/support/team-fixture';
import {knowledgeTools} from '../../../tools/runtime/knowledge-tools';
import {prepareTeamTask} from '../../../execution/context/team-workflow';
import {WorkspaceExecutionManager} from '../execution-manager';
import {LoopRuntime} from '../../../execution/rules/index';

it('空工作区普通对话默认主 Agent，知识变化后仍可继续，保留每轮消息',async()=>{
  const f=await fixture();let manager:WorkspaceExecutionManager|undefined;
  try{
    const e=await f.app.Dispatch('add',{path:f.a}),w=f.app.Workspace(e.id);const modes:unknown[]=[];
    manager=new WorkspaceExecutionManager(w,new FileRunStorage(),async options=>{
      modes.push(options.mode);
      const runtime=new LoopRuntime({storage:new FileRunStorage(),directory:path.join(f.app.paths.Project(e.id),'loop-engine','tasks'),AcquireLease:async()=>()=>{},ToolPolicy:async()=>({allow:true}),CreateEngine:()=>({kind:'test',start:async context=>{await context.emit({type:'session.bound',data:{sessionFile:'chat-session'}})},run:async()=>({status:'completed'}),stop:async()=>{},close:async()=>{}})});
      return {runtime,workspace:await f.app.paths.Identity(f.a),agentHome:'test',NewTask:()=>{throw Error('not used')}};
    });
    const options={provider:'test',model:'test',allowNativeExecution:false};
    await expect(manager.Chat('   ',options)).rejects.toThrow();
    const first=await manager.Chat('你好',options);
    while((await manager.Inspect(first.taskId,first.runId)).status==='running')await new Promise(r=>setTimeout(r,10));
    const state=await manager.Inspect(first.taskId,first.runId);expect(state.task).toMatchObject({mode:'chat',agentId:'cbim:main',moduleIds:[],acceptance:[]});expect(state.task.workflowContext).toBeUndefined();
    await fs.appendFile(path.join(f.a,'.cbim/README.md'),'\nKnowledge changed');
    const next=await manager.Resume(first.taskId,first.runId,'再聊聊',options);
    while((await manager.Inspect(next.taskId,next.runId)).status==='running')await new Promise(r=>setTimeout(r,10));
    expect((await manager.Thread(first.taskId)).map(r=>r.events[0].data.message)).toEqual(['你好','再聊聊']);expect(modes).toEqual(['chat','chat']);
    await expect(manager.Resume(first.taskId,first.runId,'旧轮次',options)).rejects.toMatchObject({code:'STALE_RUN'});
  }finally{await manager?.Close();await f.cleanup()}
});

it('旧直接业务新启动和续轮明确拒绝；实际运行日志仍可读且不改写或借机创建模型',async()=>{
  const f=await fixture();let manager:WorkspaceExecutionManager|undefined,legacy:LoopRuntime|undefined;
  try{
    const e=await f.app.Dispatch('add',{path:f.a}),w=f.app.Workspace(e.id),seeded=await seedTeam(w);
    let factoryCalls=0;
    manager=new WorkspaceExecutionManager(w,new FileRunStorage(),async()=>{factoryCalls++;throw Error('旧业务不能进入工厂')});
    const options={provider:'test',model:'test',allowNativeExecution:false};
    await expect(manager.Start(seeded.input,options)).rejects.toMatchObject({code:'OWNER_DISPATCH_REQUIRED'});
    await expect(f.app.Dispatch('loop.start',{id:e.id,task:seeded.input,options})).rejects.toMatchObject({code:'OWNER_DISPATCH_REQUIRED'});
    expect(factoryCalls).toBe(0);expect(await manager.List()).toEqual([]);
    // 此处用通用 Core runtime 产生旧形状日志以测读取/拒绝接续，不通过应用入口写入假 owner；真实旧 EXE 另有兼容冒烟。
    const prepared=await prepareTeamTask(w,seeded.input),directory=path.join(f.app.paths.Project(e.id),'loop-engine','tasks');
    legacy=new LoopRuntime({storage:new FileRunStorage(),directory,AcquireLease:async()=>()=>{},ToolPolicy:async()=>({allow:true}),CreateEngine:()=>({kind:'test',start:async context=>{await context.emit({type:'session.bound',data:{sessionFile:'test-session'}})},run:async()=>({status:'completed'}),stop:async()=>{},close:async()=>{}})});
    const run=await legacy.Start(prepared);await run.done;await legacy.Close();
    const runDirectory=path.join(directory,prepared.taskId,run.runId),bytes=async()=>{const files=await fs.readdir(runDirectory,{withFileTypes:true});return Promise.all(files.filter(file=>file.isFile()).map(async file=>[file.name,(await fs.readFile(path.join(runDirectory,file.name))).toString('base64')]))};
    const before=await bytes(),state=await manager.Inspect(prepared.taskId,run.runId);
    expect(state.task.workflowContext?.workflowId).toBe(seeded.input.workflowId);expect(state.task.ownerBinding).toBeUndefined();expect(state.status).toBe('completed');
    const thread=await f.app.Dispatch('loop.thread',{id:e.id,taskId:prepared.taskId});
    expect(thread[0].events[0].data.message).toBe(seeded.input.goal);
    await fs.appendFile(path.join(f.a,'.cbim/README.md'),'\nChanged');
    await expect(manager.Resume(prepared.taskId,run.runId,'继续',options)).rejects.toMatchObject({code:'OWNER_DISPATCH_REQUIRED'});
    await expect(f.app.Execution(e.id).Resume(prepared.taskId,run.runId,'继续',options)).rejects.toMatchObject({code:'OWNER_DISPATCH_REQUIRED'});
    expect(factoryCalls).toBe(0);expect(await bytes()).toEqual(before);expect(await fs.readdir(path.join(directory,prepared.taskId))).toEqual([run.runId]);
    const other=await f.app.Dispatch('add',{path:f.b});
    await expect(f.app.Execution(other.id).Inspect(prepared.taskId,run.runId)).rejects.toThrow();
  }finally{await legacy?.Close();await manager?.Close();await f.cleanup()}
});
