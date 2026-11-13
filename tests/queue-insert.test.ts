import {it,expect,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {fixture} from './helpers';
import {transcript} from '../src/view/execution-view/transcript';
import {PiRpc} from '../src/logic/execution/engines/pi/rpc';
import {usageScopes} from './scope-usage-fixture';

it('real Pi accepts queued steering without aborting the active request or losing the current tool',async()=>{
 const f=await fixture();let received!:()=>void,release!:()=>void;const firstRequest=new Promise<void>(r=>received=r),gate=new Promise<void>(r=>release=r);const bodies:any[]=[];const rpc=vi.spyOn(PiRpc.prototype,'request');
 const file=path.join(f.a,'src','note.txt');await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,'TOOL_EVIDENCE');
 const server=http.createServer(async(req,res)=>{
  let raw='';for await(const c of req)raw+=c;const body=JSON.parse(raw);bodies.push(body);const n=bodies.length;
  if(n===1){received();await gate}
  const delta=n===1?{role:'assistant',tool_calls:[{index:0,id:'original-read',type:'function',function:{name:'read',arguments:JSON.stringify({path:file})}}]}:{role:'assistant',content:'Followed updated instruction.'};
  res.writeHead(200,{'Content-Type':'text/event-stream'});for(const [d,reason] of [[delta,null],[{},n===1?'tool_calls':'stop']])res.write('data: '+JSON.stringify({id:'c'+n,object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta:d,finish_reason:reason}]})+'\n\n');res.end('data: [DONE]\n\n');
 });await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 try{
 const entry=await f.app.dispatch('add',{path:f.a});await f.app.models.save({profile:{name:'local',api:'openai-completions',baseUrl:`http://127.0.0.1:${(server.address() as any).port}/v1`,auth:'none',models:[{id:'test',name:'test',enabled:true,contextWindow:32768,maxTokens:1024,reasoning:false}],defaultModel:'test'}});
 const run=await f.app.dispatch('loop.chat',{id:entry.id,message:'read note',options:{permission:'read'}});await firstRequest;
 const queued=await f.app.dispatch('loop.enqueue',{id:entry.id,taskId:run.taskId,message:'INSERTED_USER_INSTRUCTION',options:{permission:'execute'}});
 await f.app.dispatch('loop.queueInsert',{id:entry.id,taskId:run.taskId,queueId:queued.id,expectedRunId:run.runId});expect(await f.app.dispatch('loop.queue',{id:entry.id,taskId:run.taskId})).toEqual([]);release();
 let result=await f.app.execution(entry.id).inspect(run.taskId,run.runId);while(result.status==='running'){await new Promise(r=>setTimeout(r,20));result=await f.app.execution(entry.id).inspect(run.taskId,run.runId)}
 expect(result.status,JSON.stringify(result.events.at(-1))).toBe('completed');
 expect(result.events.some(e=>e.type==='tool.finished'&&e.data.id==='original-read')).toBe(true);
 expect(JSON.stringify(bodies.at(-1))).toContain('INSERTED_USER_INSTRUCTION');expect(bodies.at(-1).tools.some((t:any)=>t.function.name==='write')).toBe(false);
 expect(transcript(result).some(x=>x.kind==='user'&&x.text==='INSERTED_USER_INSTRUCTION')).toBe(true);
 // 已接受的原 run/queue 返回持久事实，即使原运行已结束，也不重新发送或重复登记目标输入。
 await vi.waitFor(async()=>expect((await usageScopes(f.user,entry.id))[0].status).toBe('closed'));
 const scopes=await usageScopes(f.user,entry.id),canonicalPath=path.join(f.user,entry.id,'loop-engine','tasks',run.taskId,run.runId,'events.jsonl'),canonical=await fs.readFile(canonicalPath,'utf8'),native=await fs.readFile(result.sessionFile!,'utf8'),count=bodies.length;
 expect(scopes[0].activeInputs).toHaveLength(1);expect(scopes[0].activeInputs?.[0]).toMatchObject({status:'accepted',queueId:queued.id,runId:run.runId,inputRevision:2});expect(scopes[0].goal?.inputRevision).toBe(2);expect(rpc.mock.calls.filter(call=>call[0]==='steer')).toHaveLength(1);
 await expect(f.app.dispatch('loop.queueInsert',{id:entry.id,taskId:run.taskId,queueId:queued.id,expectedRunId:run.runId})).resolves.toBeUndefined();
 expect(rpc.mock.calls.filter(call=>call[0]==='steer')).toHaveLength(1);expect(bodies).toHaveLength(count);expect(await usageScopes(f.user,entry.id)).toEqual(scopes);expect(await fs.readFile(canonicalPath,'utf8')).toBe(canonical);expect(await fs.readFile(result.sessionFile!,'utf8')).toBe(native);expect(await f.app.dispatch('loop.queue',{id:entry.id,taskId:run.taskId})).toEqual([]);
 }finally{rpc.mockRestore();release();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await f.cleanup()}
},60000);
