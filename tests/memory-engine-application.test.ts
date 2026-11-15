import {test,expect,vi} from 'vitest';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './helpers';
import {budgetScopes} from './scope-budget-fixture';
import {memoryChatReply,memoryEmbeddingReply} from './memory-engine-data';
import type {RunSummary} from '../src/logic/execution/rules/types';

test.each(['complete','unknown-after-write'])('完整应用记忆引擎的真实知识事务与双模型账本：%s',async mode=>{
  const f=await fixture(),requests:{path:string;body:any}[]=[];let writeInput:Record<string,unknown>={},chats=0;
  const server=http.createServer((req,res)=>{void(async()=>{
    const parts:Buffer[]=[];for await(const part of req)parts.push(Buffer.from(part));const body=JSON.parse(Buffer.concat(parts).toString());requests.push({path:req.url!,body});
    const result=req.url==='/v1/embeddings'?(mode==='unknown-after-write'&&chats?{data:[{index:0,embedding:[1,0]}]}:memoryEmbeddingReply()):++chats===1?memoryChatReply('cbim_knowledge_commit',writeInput):memoryChatReply();
    res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify(result));
  })().catch(()=>{res.writeHead(500).end()})});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const baseUrl='http://127.0.0.1:'+(server.address() as import('node:net').AddressInfo).port+'/v1';
    const settings=await f.app.models.save({profile:{name:'Memory integration',api:'openai-completions',baseUrl,auth:'none',defaultModel:'chat',models:[{id:'chat',name:'Chat',enabled:true,contextWindow:32768,maxTokens:1024,reasoning:false,pricing:{input:2,output:3,cacheRead:1,cacheWrite:1}}],embedding:{api:'openai-embeddings',baseUrl,models:[{id:'vector',name:'Vector',enabled:true,inputTokens:8192,dimensions:2,inputPrice:1}]}}});
    const profileId=settings.selectedId!,entry=await f.app.dispatch('add',{path:f.a}),owner=f.app.workspace(entry.id),snapshot=await owner.read();
    const original=snapshot.files.find(file=>file.path==='.cbim/team/skills.json')!;expect(original).toBeDefined();
    writeInput={workspaceId:entry.id,instanceId:owner.instanceId,revision:snapshot.revision,requestId:'memory-write',changes:[{path:original.path,text:original.text+'\n'}]};
    await f.app.dispatch('budget.configure',{revision:1,enabled:true,enforcement:'request',limits:{tokens:1000000}});
    const start=await f.app.dispatch('loop.chat',{id:entry.id,message:'在团队技能清单末尾补一个换行并保留其全部内容，再总结来源。',options:{engine:'memory',profileId,model:'chat',modelRoles:{version:2,roles:{embedding:{kind:'embedding',profileId,modelId:'vector'}}},permission:'execute',turnTimeoutMs:10000}});
    await vi.waitFor(async()=>expect((await budgetScopes(f.user,entry.id))[0]?.status).toBe('closed'),{timeout:15000});
    const scope=(await budgetScopes(f.user,entry.id))[0],summary:RunSummary=await f.app.dispatch('loop.inspect',{id:entry.id,taskId:start.taskId,runId:start.runId});
    expect(summary.toolReceipts?.filter(r=>r.toolName==='cbim_knowledge_commit')).toHaveLength(1);expect(summary.toolReceipts?.find(r=>r.toolName==='cbim_knowledge_commit')?.outcome).toBe('succeeded');
    expect((await owner.read()).files.find(file=>file.path===original.path)?.text).toBe(original.text+'\n');
    const report=await f.app.dispatch('dispatch.requestBudget',{workspaceId:entry.id,rootSessionId:start.taskId,scopeId:scope.scopeId});
    expect(report.requests).toBe(requests.length);expect(report.unknown).toBe(mode==='complete'?0:1);expect(report.reported).toBe(requests.length-(mode==='complete'?0:1));
    expect(requests.filter(r=>r.path==='/v1/chat/completions')).toHaveLength(mode==='complete'?2:1);
    expect(scope.outcome,JSON.stringify(summary.events.at(-1))).toBe(mode==='complete'?'completed':'interrupted');
    if(mode==='unknown-after-write')expect(JSON.stringify(summary.events.at(-1))).toContain('向量索引尚未同步');
    const journal=await fs.readFile(path.join(f.app.paths.project(entry.id),'dispatch','dispatch.jsonl'),'utf8');expect(journal).toContain('openai-embeddings');expect(journal).toContain('openai-completions');expect(journal).not.toContain('apiKey');
  }finally{await f.cleanup();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}
},25000);
