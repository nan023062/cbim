import {expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {fixture} from './helpers';
import {internalKnowledge} from './knowledge-tool-fixture';
import {seedTeam} from './team-fixture';
import type {RunSummary} from '../src/backend/core/brain/types';

const cases=[
  {mode:'auto',permission:'read',modules:false},
  {mode:'auto',permission:'ask',modules:false},
  {mode:'auto',permission:'execute',modules:false},
  {mode:'auto',permission:'execute',modules:true},
  {mode:'team',permission:'read',modules:false},
  {mode:'team',permission:'ask',modules:false},
  {mode:'team',permission:'execute',modules:false},
  {mode:'team',permission:'execute',modules:true},
] as const;

/** 真实 Application / Pi / 原生文件与命令；仅模型回复为确定性本地 SSE。 */
it.each(cases)('main direct work keeps permission and knowledge boundaries ($mode / $permission / modules=$modules)',async({mode,permission,modules})=>{
  const f=await fixture(),requests:any[]=[],errors:unknown[]=[];
  let identity:{workspaceId:string;instanceId:string};
  const server=http.createServer(async(req,res)=>{
    try{
      let raw='';for await(const chunk of req)raw+=chunk;
      const body=JSON.parse(raw),turn=requests.length;requests.push(body);
      res.writeHead(200,{'Content-Type':'text/event-stream'});
      const emit=(delta:unknown,finish_reason:string|null)=>res.write('data: '+JSON.stringify({id:'direct-'+turn,object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta,finish_reason}]})+'\n\n');
      const calls=[
        ['cbim_module_registry',{...identity,query:'no-matching-module'}],
        ['cbim_module_get',{...identity,id:'cbim:project'}],
        ['write',{path:'.cbim/README.md',content:'forbidden knowledge overwrite'}],
        ['write',{path:'direct-work.txt',content:'ISSUE14_DIRECT_WORK'}],
        ['read',{path:'input.txt'}],
        ['bash',{command:'echo ISSUE14_NATIVE_COMMAND'}],
      ] as const;
      if(turn<calls.length){const [name,args]=calls[turn];emit({role:'assistant',tool_calls:[{index:0,id:'direct-call-'+turn,type:'function',function:{name,arguments:JSON.stringify(args)}}]},null);emit({},'tool_calls')}
      else {emit({role:'assistant',content:'已按真实工具结果结束本轮。'},null);emit({},'stop')}
      res.end('data: [DONE]\n\n');
    }catch(error){errors.push(error);res.writeHead(500);res.end('fixture failed')}
  });
  try{
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
    await f.app.models.save({profile:{name:'Direct main fixture',api:'openai-completions',baseUrl:`http://127.0.0.1:${(server.address() as any).port}/v1`,auth:'none',defaultModel:'direct-main',models:[{id:'direct-main',name:'Fixture',enabled:true,contextWindow:65536,maxTokens:1024,reasoning:false}]}});
    const entry=await f.app.dispatch('add',{path:f.a}),workspace=f.app.workspace(entry.id),manager=f.app.execution(entry.id);
    if(modules)await seedTeam(workspace);
    identity={workspaceId:entry.id,instanceId:workspace.instanceId};
    const before=await workspace.snapshot();await fs.writeFile(path.join(f.a,'input.txt'),'ISSUE14_INPUT');
    const started=await f.app.dispatch('loop.chat',{id:entry.id,message:'直接读取输入并实现一个文件，再执行验证；不用先配置团队。',options:{permission,collaborationMode:mode,turnTimeoutMs:30000}});
    const approved=new Set<string>();let result:RunSummary;
    await vi.waitFor(async()=>{
      for(const approval of await manager.pendingApprovals(started.taskId)){
        expect(permission).toBe('ask');expect(['write','bash']).toContain(approval.name);
        expect(JSON.stringify(approval)).not.toContain('forbidden knowledge overwrite');
        if(!approved.has(approval.id)){
          if(approved.size===0){
            await expect(fs.stat(path.join(f.a,'direct-work.txt'))).rejects.toMatchObject({code:'ENOENT'});
            await expect(f.app.dispatch('loop.chat',{id:entry.id,message:'不得与等待写审批的主会话并发启动',options:{permission:'read',collaborationMode:'auto'}})).rejects.toMatchObject({code:'WORKSPACE_EXECUTION_BUSY'});
          }
          approved.add(approval.id);await manager.answerApproval(started.taskId,approval.id,true);
        }
      }
      result=await manager.inspect(started.taskId,started.runId);expect(result.status).toBe('completed');
    },{timeout:45000,interval:60});
    const canWrite=permission!=='read';
    if(canWrite){
      const command=result!.events.find(event=>event.type==='tool.finished'&&event.data.id==='direct-call-5');
      expect(command?.data).toMatchObject({isError:false,receipt:{outcome:'succeeded'}});
      expect(JSON.stringify(command?.data.result)).toContain('ISSUE14_NATIVE_COMMAND');
    }
    if(canWrite)expect(await fs.readFile(path.join(f.a,'direct-work.txt'),'utf8')).toBe('ISSUE14_DIRECT_WORK');
    else await expect(fs.stat(path.join(f.a,'direct-work.txt'))).rejects.toMatchObject({code:'ENOENT'});
    expect((await workspace.snapshot()).revision).toBe(before.revision);
    expect(requests).toHaveLength(7);expect(errors).toEqual([]);
    const instructions=JSON.stringify(requests[0].messages);
    expect(instructions).not.toContain('不能自行完成正式业务任务');
    expect(instructions).not.toContain('禁止把 cbim:main 作为业务执行角色');
    expect(instructions).toContain('未配置自定义');
    expect(instructions).toContain('直接');
    // 0.1.7 明确区分主会话直接执行与独立成员 assignee；检查真实发送给模型的现行约束。
    if(mode==='team')expect(instructions).toContain('禁止把 cbim:main 作为独立成员 assignee');
    expect(approved.size).toBe(permission==='ask'?2:0);
    const advertised=requests[0].tools.map((tool:any)=>tool.function.name);
    expect(advertised.includes('write')).toBe(canWrite);expect(JSON.stringify(requests[0].messages)).not.toContain('主 Agent 不提供业务写入或命令执行');expect(advertised.includes('bash')).toBe(canWrite);
    expect(JSON.stringify(requests[2].messages)).toContain('项目根模块');
    expect(JSON.stringify(requests[5].messages)).toContain('ISSUE14_INPUT');
    if(canWrite)expect(JSON.stringify(requests[6].messages)).toContain('ISSUE14_NATIVE_COMMAND');
    await vi.waitFor(async()=>expect((await workspace.dispatchStore.read()).scopes?.find(scope=>scope.rootSessionId===started.taskId)).toMatchObject({status:'closed',outcome:'completed'}),{timeout:5000});
    const state=await workspace.dispatchStore.read();expect(state.graphs[0].tasks).toEqual([]);expect(state.workspaceMembers??[]).toEqual([]);expect(state.moduleOwnerships??[]).toEqual([]);
    const registry=await internalKnowledge(workspace).call('cbim_module_registry');expect(registry.projectRoot.id).toBe('cbim:project');expect(registry.projectRoot.children.length>0).toBe(modules);
    const count=requests.length;await f.app.open(entry.id,true);expect(await f.app.execution(entry.id).thread(started.taskId)).toHaveLength(1);expect(requests).toHaveLength(count);
    if(canWrite)expect(await fs.readFile(path.join(f.a,'direct-work.txt'),'utf8')).toBe('ISSUE14_DIRECT_WORK');
  }finally{await f.cleanup();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}
},65000);
