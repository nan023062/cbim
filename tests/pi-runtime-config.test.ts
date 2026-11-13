import {test,expect,vi} from 'vitest';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './helpers';
import {buildPiRuntimeSettings,requestedThinkingLevel} from '../src/backend/engines/pi/runtime-config';
import {modelSchema} from '../src/logic/models';
import type {WorkspaceExecutionManager} from '../src/backend/scheduler-engine/conversation/execution-manager';
import type {RunSummary} from '../src/backend/core/execution/types';

/** A queued resume receipt identifies the previous run; wait for its actual successor before asserting Pi events. */
async function completedTurn(manager:WorkspaceExecutionManager,receipt:{taskId:string;runId:string;queued?:boolean}){
 let result:RunSummary|undefined;
 await vi.waitFor(async()=>{result=(await manager.thread(receipt.taskId)).at(-1);expect(result).toBeDefined();if(receipt.queued)expect(result!.runId).not.toBe(receipt.runId);else expect(result!.runId).toBe(receipt.runId);expect(result!.status).not.toBe('running');expect((manager as any).active.has(receipt.taskId)).toBe(false)},{timeout:20000,interval:20});
 return result!;
}

test('working budget changes native compaction reserve, never model capacity',()=>{
 expect(buildPiRuntimeSettings()).not.toHaveProperty('compaction');
 expect(buildPiRuntimeSettings({contextWindow:128000,workingContextWindow:64000})).toMatchObject({transport:'sse',compaction:{reserveTokens:70400},retry:{enabled:true,maxRetries:6,baseDelayMs:2000,provider:{maxRetries:0}}});
 expect(buildPiRuntimeSettings({contextWindow:128000,compactionPercent:80})).toHaveProperty('compaction.reserveTokens',25600);
 expect(requestedThinkingLevel({reasoning:false,thinkingLevel:'high'})).toBe('off');
 expect(requestedThinkingLevel({reasoning:true})).toBe('medium');
 expect(requestedThinkingLevel({reasoning:true,thinkingLevel:'off'})).toBe('off');
 expect(modelSchema.safeParse({id:'a',name:'a',enabled:true,reasoning:true,contextWindow:32768,maxTokens:4096,workingContextWindow:64000}).success).toBe(false);
});

test('real Pi applies isolated settings, retries one transient failure, and reapplies thinking on resume/model switch',async()=>{
 const f=await fixture();const requests:any[]=[];
 const server=http.createServer(async(req,res)=>{let raw='';for await(const c of req)raw+=c;const body=JSON.parse(raw);requests.push(body);
   if(requests.length===1){res.writeHead(503,{'Content-Type':'application/json'}).end(JSON.stringify({error:{message:'Service temporarily unavailable'}}));return}
   res.writeHead(200,{'Content-Type':'text/event-stream'});
   for(const [delta,finish] of [[{role:'assistant',content:'Verified'},null],[{},'stop']])res.write('data: '+JSON.stringify({id:'r'+requests.length,object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta,finish_reason:finish}]})+'\n\n');res.end('data: [DONE]\n\n');
 });
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 try{
  const entry=await f.app.dispatch('add',{path:f.a});
  const model={id:'thinking',name:'Thinking',enabled:true,reasoning:true,contextWindow:65536,maxTokens:8192,thinkingLevel:'low' as const,workingContextWindow:40000,compactionPercent:80,pricing:{input:1,output:2,cacheRead:0.1,cacheWrite:1}};
  const definition={name:'Runtime test',api:'openai-completions',baseUrl:`http://127.0.0.1:${(server.address() as any).port}/v1`,auth:'none',defaultModel:'thinking',models:[model,{...model,id:'plain',reasoning:false}]};
  const saved=await f.app.dispatch('models.save',{profile:definition});const options={profileId:saved.selectedId,model:'thinking',permission:'read',turnTimeoutMs:15000};
  const manager=f.app.execution(entry.id);
  const wait=(run:{taskId:string;runId:string;queued?:boolean})=>completedTurn(manager,run);
  const run=await f.app.dispatch('loop.chat',{id:entry.id,message:'Hello',options});const first=await wait(run);
  expect(first.status,JSON.stringify(first.events.at(-1))).toBe('completed');expect(requests.length).toBe(2);
  expect(first.events.some(e=>e.type==='engine.status'&&e.data.label==='模型连接重试中')).toBe(true);
  expect(first.events.find(e=>e.data.label==='Pi 运行配置已应用')?.data).toMatchObject({thinkingLevel:'low',contextWindow:65536,maxTokens:8192,autoCompaction:true});
  expect(requests[1].reasoning_effort).toBe('low');
  expect(first.events.filter(e=>e.data.metric==='request-limit').at(-1)?.data.maxTokens).toBe(requests[1].max_tokens??requests[1].max_completion_tokens);
  expect(first.events.find(e=>e.type==='message')?.data.pricingKnown).toBe(true);
  expect(first.events.find(e=>e.type==='message')?.data.generationDurationMs).toBeGreaterThan(0);
  const directory=path.join(f.app.paths.project(entry.id),'loop-engine','tasks',run.taskId,run.runId,'provider');
  expect(JSON.parse(await fs.readFile(path.join(directory,'settings.json'),'utf8'))).toMatchObject({transport:'sse',compaction:{enabled:true,reserveTokens:33536},retry:{enabled:true,maxRetries:6,baseDelayMs:2000,provider:{maxRetries:0}}});
  const models=JSON.parse(await fs.readFile(path.join(directory,'models.json'),'utf8'));expect(Object.values<any>(models.providers)[0].models[0].contextWindow).toBe(65536);expect(Object.values<any>(models.providers)[0].models[0].cost).toEqual(model.pricing);
  await f.app.dispatch('models.save',{id:saved.selectedId,profile:{...definition,models:[{...model,thinkingLevel:'off'},definition.models[1]]}});
  const next=await f.app.dispatch('loop.resume',{id:entry.id,taskId:run.taskId,runId:run.runId,message:'Continue',options});const second=await wait(next);
  expect(second.status).toBe('completed');expect(second.sessionFile).toBe(first.sessionFile);expect(second.events.find(e=>e.data.label==='Pi 运行配置已应用')?.data.thinkingLevel).toBe('off');
  const switched=await f.app.dispatch('loop.resume',{id:entry.id,taskId:run.taskId,runId:second.runId,message:'Plain model',options:{...options,model:'plain'}});const third=await wait(switched);
  expect(third.status).toBe('completed');expect(third.events.find(e=>e.data.label==='Pi 运行配置已应用')?.data.thinkingLevel).toBe('off');
  expect(JSON.parse(await fs.readFile(path.join(directory,'settings.json'),'utf8')).compaction.reserveTokens).toBe(33536);
 }finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await f.cleanup()}
},30000);

test('real Pi performs native compaction when the working threshold is reached',async()=>{
 const f=await fixture();let count=0;
 const server=http.createServer(async(req,res)=>{let raw='';for await(const c of req)raw+=c;const body=JSON.parse(raw);count++;
   res.writeHead(200,{'Content-Type':'text/event-stream'});
   const content=count===1?'Initial answer.':'Summary: user greeted; no files changed; continue normally.';
   res.write('data: '+JSON.stringify({id:'compact-'+count,object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta:{role:'assistant',content},finish_reason:null}]})+'\n\n');
   res.write('data: '+JSON.stringify({id:'compact-'+count,object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:count===2?60000:100,completion_tokens:20,total_tokens:count===2?60020:120}})+'\n\n');res.end('data: [DONE]\n\n');
 });await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 try{
  const entry=await f.app.dispatch('add',{path:f.a});
  const saved=await f.app.dispatch('models.save',{profile:{name:'Compaction',api:'openai-completions',baseUrl:`http://127.0.0.1:${(server.address() as any).port}/v1`,auth:'none',defaultModel:'test',models:[{id:'test',name:'test',enabled:true,reasoning:false,contextWindow:65536,maxTokens:4096,workingContextWindow:40000,compactionPercent:80}]}});
  const run=await f.app.dispatch('loop.chat',{id:entry.id,message:'Hello. '+('Context for summary. '.repeat(1500)),options:{profileId:saved.selectedId,turnTimeoutMs:15000}});
  const manager=f.app.execution(entry.id);let result=await completedTurn(manager,run);
  const next=await f.app.dispatch('loop.resume',{id:entry.id,taskId:run.taskId,runId:run.runId,message:'Continue. '+('Recent context. '.repeat(6000)),options:{profileId:saved.selectedId,turnTimeoutMs:15000}});
  result=await completedTurn(manager,next);expect(result.runId).not.toBe(run.runId);
  expect(result.status,JSON.stringify(result.events.at(-1))).toBe('completed');
  expect(result.events.some(e=>e.data.label==='正在整理对话上下文')).toBe(true);
  expect(result.events.some(e=>e.data.label==='上下文整理结束')).toBe(true);expect(count).toBeGreaterThan(1);
  expect(result.events.filter(e=>e.data.metric==='context').length).toBeGreaterThan(0);
  expect(result.events.filter(e=>e.data.metric==='context').at(-1)?.data.tokens).toBeNull();
  const usage=result.events.find(e=>e.data.metric==='run-usage')?.data.tokens as any;
  expect(usage.input).toBeGreaterThan(60000);expect(usage.output).toBeGreaterThan(20);
 }finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await f.cleanup()}
},30000);
