import {expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {fixture} from './helpers';

/** Actual Application, Pi, native files and durable goal review; deterministic localhost model only. */
it.each(['auto','team'] as const)('主 Agent 在原会话执行并用真实证据闭合目标，不创建默认成员 (%s)',async mode=>{
  const f=await fixture(),requests:any[]=[],errors:unknown[]=[];
  const server=http.createServer(async(req,res)=>{try{
    let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw),turn=requests.length;requests.push(body);
    res.writeHead(200,{'Content-Type':'text/event-stream'});
    const emit=(delta:unknown,finish_reason:string|null)=>res.write('data: '+JSON.stringify({id:'direct-goal-'+turn,object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta,finish_reason}]})+'\n\n');
    const calls=[
      ['direct-plan','cbim_goal_plan',{expectedRevision:1,objective:'实现并验证输出文件',constraints:[],criteria:[{id:'c1',text:'文件内容正确',kind:'evidence'}],assignments:[{agentId:'cbim:main',moduleIds:['cbim:project'],criterionIds:['c1'],reason:'模块默认主 Agent'}],reason:'原会话直接完成'}],
      ['direct-write','write',{path:'main-result.txt',content:'MAIN_EXECUTION_FACT'}],
      ['direct-read','read',{path:'main-result.txt'}],
      ['direct-review','cbim_goal_review',{expectedRevision:2,decision:'complete',checks:[{criterionId:'c1',outcome:'satisfied',reason:'实际读取已验证',evidence:[{kind:'main-execution',toolCallIds:['direct-read']}]}],superseded:[],gaps:[],reason:'原会话真实完成'}],
    ] as const;
    if(turn<calls.length){const [id,name,args]=calls[turn];emit({role:'assistant',tool_calls:[{index:0,id,type:'function',function:{name,arguments:JSON.stringify(args)}}]},null);emit({},'tool_calls')}
    else{emit({role:'assistant',content:'文件已实现并核实。'},null);emit({},'stop')}
    res.end('data: [DONE]\n\n');
  }catch(error){errors.push(error);res.writeHead(500);res.end('fixture failed')}});
  try{
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
    await f.app.models.save({profile:{name:'Direct goal',api:'openai-completions',baseUrl:'http://127.0.0.1:'+(server.address() as any).port+'/v1',auth:'none',defaultModel:'direct',models:[{id:'direct',name:'Fixture',enabled:true,contextWindow:65536,maxTokens:1024,reasoning:false}]}});
    const entry=await f.app.dispatch('add',{path:f.a}),workspace=f.app.workspace(entry.id),before=await workspace.snapshot();
    const run=await f.app.dispatch('loop.chat',{id:entry.id,message:'没有团队时自己实现并验证文件',options:{permission:'execute',collaborationMode:mode,turnTimeoutMs:30000}});
    await vi.waitFor(async()=>expect((await workspace.dispatchStore.read()).scopes?.find(scope=>scope.rootSessionId===run.taskId)).toMatchObject({status:'closed',outcome:'completed',goal:{review:{decision:'complete'}}}),{timeout:30000,interval:40});
    const state=await workspace.dispatchStore.read(),summary=await f.app.execution(entry.id).inspect(run.taskId,run.runId);
    expect(summary.status).toBe('completed');expect(summary.toolReceipts?.every(receipt=>receipt.outcome==='succeeded')).toBe(true);expect(summary.toolReceipts).toHaveLength(4);
    expect(await fs.readFile(path.join(f.a,'main-result.txt'),'utf8')).toBe('MAIN_EXECUTION_FACT');expect(state.graphs[0].tasks).toEqual([]);expect(state.members).toHaveLength(1);expect(state.members[0].agentId).toBe('cbim:main');
    expect(state.workspaceMembers??[]).toEqual([]);expect(state.moduleOwnerships??[]).toEqual([]);expect((await workspace.snapshot()).files).toEqual(before.files);expect(requests).toHaveLength(5);expect(errors).toEqual([]);
    await f.app.open(entry.id,true);expect(requests).toHaveLength(5);expect(await f.app.execution(entry.id).thread(run.taskId)).toHaveLength(1);
  }finally{await f.cleanup();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}
},45000);
