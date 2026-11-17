// logic/conversation/runtime: module-owned integration coverage; keep the original scenario and cleanup semantics.
import {test,expect} from 'vitest';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fixture} from '../../application/support/helpers';
import {modelStopError} from '../../../../../src/logic/execution/rules/model-errors';
import {transcript} from '../../../../../src/view/execution-view/transcript';
test('real Pi stops on length once and explicitly resumes the same conversation',async()=>{
 const f=await fixture();let requests=0;const toolSets:string[][]=[];const prompts:string[]=[];
 const server=http.createServer(async(req,res)=>{let raw='';for await(const c of req)raw+=c;const body=JSON.parse(raw);prompts.push(JSON.stringify(body.messages));toolSets.push((body.tools||[]).map((t:any)=>t.function.name));requests++;res.writeHead(200,{'Content-Type':'text/event-stream'});for(const [delta,finish] of [[{role:'assistant',content:requests===1?'partial':'resumed'},null],[{},requests===1?'length':'stop']])res.write('data: '+JSON.stringify({id:'length-'+requests,object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta,finish_reason:finish}]})+'\n\n');res.end('data: [DONE]\n\n')});
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 try{const entry=await f.app.Dispatch('add',{path:f.a});const home=path.join(f.app.paths.Project(entry.id),'loop-engine','pi');await fs.mkdir(home,{recursive:true});await fs.writeFile(path.join(home,'models.json'),JSON.stringify({providers:{'length-test':{baseUrl:`http://127.0.0.1:${(server.address() as any).port}/v1`,api:'openai-completions',apiKey:'test',models:[{id:'test',reasoning:false,input:['text'],contextWindow:32768,maxTokens:4096,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}}]}}}));
 const options={provider:'length-test',model:'test',turnTimeoutMs:10000};const manager=f.app.Execution(entry.id);
 // 终态日志先于子进程清理完成；等待本轮移出活动表后才发起下一轮。
 const wait=async(taskId:string,runId:string)=>{let result=await manager.Inspect(taskId,runId);while(result.status==='running'||(manager as any).active.has(taskId)){await new Promise(r=>setTimeout(r,20));result=await manager.Inspect(taskId,runId)}return result};
 const first=await f.app.Dispatch('loop.chat',{id:entry.id,message:'Create file',options});const result=await wait(first.taskId,first.runId);expect(result.status).toBe('failed');expect(result.events.at(-1)?.data.error).toContain('模型返回长度限制');expect(requests).toBe(1);
 const next=await f.app.Dispatch('loop.resume',{id:entry.id,taskId:first.taskId,runId:first.runId,message:'Continue after checking existing results',options:{...options,permission:'execute'}});const resumed=await wait(next.taskId,next.runId);expect(resumed.status).toBe('completed');expect(resumed.sessionFile).toBe(result.sessionFile);expect(requests).toBe(2);
 // 原生会话恢复沿用身份，但本轮工具按显式权限刷新；execute 允许主执行，下一轮 read 再次收紧。
 expect(prompts[1]).toContain('主 Agent');
 for(const name of ['write','edit','bash'])expect(toolSets[1]).toContain(name);
 const third=await f.app.Dispatch('loop.resume',{id:entry.id,taskId:first.taskId,runId:next.runId,message:'Read only now',options:{...options,permission:'read'}});expect((await wait(third.taskId,third.runId)).status).toBe('completed');expect(toolSets[2]).not.toContain('write');expect(toolSets[2]).not.toContain('bash');expect(prompts[2]).toContain('主 Agent');
 }finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await f.cleanup()}
},30000);
