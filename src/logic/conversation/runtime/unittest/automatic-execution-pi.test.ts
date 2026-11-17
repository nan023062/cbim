import {expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {fixture} from '../../../application/unittest/support/helpers';

/** Actual Application, Pi and native files. Direct execution stays in one run; completion is not a legacy goal review. */
it.each(['auto','team'] as const)('主 Agent 在原会话执行并核实真实文件，不创建默认成员 (%s)',async mode=>{
  const f=await fixture(),requests:any[]=[],errors:unknown[]=[];
  const server=http.createServer(async(req,res)=>{try{
    let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw),turn=requests.length;requests.push(body);
    res.writeHead(200,{'Content-Type':'text/event-stream'});
    const emit=(delta:unknown,finish_reason:string|null)=>res.write('data: '+JSON.stringify({id:'direct-goal-'+turn,object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta,finish_reason}]})+'\n\n');
    const calls=[
      ['direct-write','write',{path:'main-result.txt',content:'MAIN_EXECUTION_FACT'}],
      ['direct-read','read',{path:'main-result.txt'}],
    ] as const;
    if(turn<calls.length){const [id,name,args]=calls[turn];emit({role:'assistant',tool_calls:[{index:0,id,type:'function',function:{name,arguments:JSON.stringify(args)}}]},null);emit({},'tool_calls')}
    else{emit({role:'assistant',content:'文件已实现并核实。'},null);emit({},'stop')}
    res.end('data: [DONE]\n\n');
  }catch(error){errors.push(error);res.writeHead(500);res.end('fixture failed')}});
  try{
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
    await f.app.models.Save({profile:{name:'Direct goal',api:'openai-completions',baseUrl:'http://127.0.0.1:'+(server.address() as any).port+'/v1',auth:'none',defaultModel:'direct',models:[{id:'direct',name:'Fixture',enabled:true,contextWindow:65536,maxTokens:1024,reasoning:false}]}});
    const entry=await f.app.Dispatch('add',{path:f.a}),workspace=f.app.Workspace(entry.id),before=await workspace.Snapshot();
    const run=await f.app.Dispatch('loop.chat',{id:entry.id,message:'没有团队时自己实现并验证文件',options:{permission:'execute',collaborationMode:mode,turnTimeoutMs:30000}});
    await vi.waitFor(async()=>expect((await f.app.Execution(entry.id).Inspect(run.taskId,run.runId)).status).toBe('completed'),{timeout:30000,interval:40});
    const state=await workspace.dispatchStore.Read(),summary=await f.app.Execution(entry.id).Inspect(run.taskId,run.runId);
    expect(summary.status).toBe('completed');expect(summary.toolReceipts?.every(receipt=>receipt.outcome==='succeeded')).toBe(true);expect(summary.toolReceipts).toHaveLength(2);
    expect(summary.conversationBinding).toMatchObject({workspaceId:entry.id,rootSessionId:run.taskId,agentId:'cbim:main'});
    expect(summary.events.some(event=>event.type==='tool.finished'&&event.data.id==='direct-read'&&JSON.stringify(event.data).includes('MAIN_EXECUTION_FACT'))).toBe(true);
    for(const request of requests){const names=request.tools.map((tool:any)=>tool.function.name);expect(names).toContain('cbim_agent_call');expect(names).not.toContain('cbim_goal_review');expect(names).not.toContain('cbim_dispatch_task');}
    expect(await fs.readFile(path.join(f.a,'main-result.txt'),'utf8')).toBe('MAIN_EXECUTION_FACT');expect(state.graphs[0].tasks).toEqual([]);expect(state.members).toHaveLength(1);expect(state.members[0].agentId).toBe('cbim:main');
    expect(state.workspaceMembers??[]).toEqual([]);expect(state.moduleOwnerships??[]).toEqual([]);expect((await workspace.Snapshot()).files).toEqual(before.files);expect(requests).toHaveLength(3);expect(errors).toEqual([]);
    await f.app.Open(entry.id,true);expect(requests).toHaveLength(3);expect(await f.app.Execution(entry.id).Thread(run.taskId)).toHaveLength(1);
  }finally{await f.cleanup();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}
},45000);
