import {it,expect} from 'vitest';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './helpers';
import {seedTeam} from './team-fixture';

/** Real pinned Pi subprocess + internal knowledge service, deterministic local model transport (not a real LLM). */
it('real Pi gates tools, calls internal knowledge, settles, and resumes its persisted session',async()=>{
  const f=await fixture();let requests=0;
  let hold=false,requestStarted:()=>void=()=>{};
  const server=http.createServer(async(req,res)=>{
    let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);requests++;
    expect(body.model).toBe('cbim-test-model');
    if(hold){requestStarted();return}
    res.writeHead(200,{'Content-Type':'text/event-stream'});
    const emit=(delta:unknown,finish_reason:string|null)=>res.write('data: '+JSON.stringify({id:'completion-'+requests,object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta,finish_reason}]})+'\n\n');
    if(requests===1){
      expect(JSON.stringify(body.messages)).toContain('团队校验规则');
      expect(JSON.stringify(body.messages)).toContain('先理解目标，再验证并记录证据');
      expect(body.tools.some((t:any)=>t.function.name==='cbim_workspace_identity')).toBe(true);
      emit({role:'assistant',tool_calls:[{index:0,id:'identity-call',type:'function',function:{name:'cbim_workspace_identity',arguments:'{}'}}]},null);emit({},'tool_calls');
    }else if(requests===2){
      emit({role:'assistant',tool_calls:[{index:0,id:'denied-read',type:'function',function:{name:'read',arguments:'{"path":".cbim/entry.md"}'}}]},null);emit({},'tool_calls');
    }else{emit({role:'assistant',content:'Verified workspace through CBIM internal tools.'},null);emit({},'stop')}
    res.end('data: [DONE]\n\n');
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const entry=await f.app.dispatch('add',{path:f.a});
    await expect(fs.access(path.join(f.app.paths.project(entry.id),'discovery.json'))).rejects.toThrow();
    await expect(fs.access(path.join(f.a,'.mcp.json'))).rejects.toThrow();
    const agentHome=path.join(f.app.paths.project(entry.id),'loop-engine','pi');
    await fs.mkdir(agentHome,{recursive:true});
    await fs.writeFile(path.join(agentHome,'models.json'),JSON.stringify({providers:{'cbim-test':{baseUrl:`http://127.0.0.1:${(server.address() as any).port}/v1`,api:'openai-completions',apiKey:'test-not-a-secret',models:[{id:'cbim-test-model',reasoning:false,input:['text'],contextWindow:32768,maxTokens:1024,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}}]}}}));
    const seeded=await seedTeam(f.app.workspace(entry.id));
    const options={provider:'cbim-test',model:'cbim-test-model',turnTimeoutMs:20000};
    const manager=f.app.execution(entry.id);
    const wait=async(taskId:string,runId:string)=>{let result=await manager.inspect(taskId,runId);while(result.status==='running'){await new Promise(r=>setTimeout(r,10));result=await manager.inspect(taskId,runId)}return result};
    const first=await f.app.dispatch('loop.start',{id:entry.id,task:seeded.input,options}),result=await wait(first.taskId,first.runId);
    const task=result.task;
    expect(result.status,JSON.stringify(result.events.at(-1))).toBe('completed');expect(result.acceptance).toBe('not_evaluated');
    expect(result.events.some(e=>e.type==='tool.allowed'&&e.data.name==='cbim_workspace_identity')).toBe(true);
    expect(result.events.some(e=>e.type==='tool.denied'&&e.data.id==='denied-read')).toBe(true);
    const identity=result.events.find(e=>e.type==='tool.finished'&&e.data.id==='identity-call');expect(JSON.stringify(identity)).toContain(task.workspaceId);
    expect(result.unresolvedTools).toEqual([]);expect(result.sessionFile).toBeTruthy();await fs.access(result.sessionFile!);
    const second=await f.app.dispatch('loop.resume',{id:entry.id,taskId:task.taskId,runId:first.runId,message:'仅总结已有结果，不重复操作。',options}),resumed=await wait(task.taskId,second.runId);
    expect(resumed.status,JSON.stringify(resumed.events.at(-1))).toBe('completed');expect(resumed.sessionFile).toBe(result.sessionFile);
    expect(requests).toBe(4);
    hold=true;
    const received=new Promise<void>(resolve=>{requestStarted=resolve});
    const third=await f.app.dispatch('loop.resume',{id:entry.id,taskId:task.taskId,runId:second.runId,message:'等待模型时测试中断。',options});
    await received;await f.app.dispatch('loop.stop',{id:entry.id,taskId:task.taskId});
    expect((await wait(task.taskId,third.runId)).status).toBe('cancelled');
  }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await f.cleanup()}
},60000);
