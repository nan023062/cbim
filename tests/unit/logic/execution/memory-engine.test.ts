import {test,expect,vi,afterEach} from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {MemoryEngine} from '../../../../src/logic/execution/engines/memory/engine';
import type {EngineContext,EngineEvent} from '../../../../src/logic/execution/rules/types';
import {memoryModel,memorySnapshot,memoryEmbeddingReply,memoryChatReply} from '../../../memory-engine-data';
const temporary:string[]=[];
afterEach(async()=>{vi.unstubAllGlobals();for(const root of temporary.splice(0)){if(path.dirname(root)!==path.resolve(os.tmpdir())||!path.basename(root).startsWith('cbim-memory-unit-'))throw Error('cleanup boundary');await fs.rm(root,{recursive:true,force:true})}});
const json=(value:unknown)=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
async function fixture(){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-memory-unit-'));temporary.push(root);const events:EngineEvent[]=[];let snapshot=memorySnapshot();
  const calls:string[]=[],port={list:async()=>['cbim_knowledge_search','cbim_knowledge_snapshot','cbim_object_commit'].map(name=>({name,inputSchema:{type:'object',properties:{},additionalProperties:true}})),call:vi.fn(async(name:string)=>{calls.push(name);if(name==='cbim_object_commit'){snapshot=memorySnapshot('知识已正式更新，保留原始来源');return {content:[{type:'text',text:JSON.stringify({state:'committed',revision:snapshot.revision})}]}}return {content:[{type:'text',text:JSON.stringify(snapshot)}]}})};
  const context:EngineContext={task:{taskId:'task',workspaceId:'workspace',root,goal:'管理知识',moduleIds:[],acceptance:[]},runId:'run',directory:root,nativeSessionId:'native',emit:async event=>{events.push(structuredClone(event))},beforeTool:async call=>({allow:true,effects:[call.name==='cbim_object_commit'?'knowledge-write':'read']})};
  const engine=(turnTimeoutMs=1000)=>new MemoryEngine({provider:'test',model:'chat',agentHome:path.join(root,'home'),prompt:'管理知识',knowledge:port,llm:memoryModel(),turnTimeoutMs});
  return {root,events,calls,port,context,engine};
}
test('准备阶段不发网；完整会话恢复复用同代索引，仅新查询产生向量请求',async()=>{
  const f=await fixture(),fetch=vi.fn(async(url:string)=>json(url.endsWith('/embeddings')?memoryEmbeddingReply():memoryChatReply()));vi.stubGlobal('fetch',fetch);
  const first=f.engine();await first.start(f.context);expect(fetch).not.toHaveBeenCalled();expect(await first.run('总结要求')).toEqual({status:'completed'});await first.close();
  const bound=f.events.find(e=>e.type==='session.bound')!;const next=f.engine();await next.start({...f.context,runId:'next',sessionFile:bound.data.sessionFile as string});expect(await next.run('再解释一次')).toEqual({status:'completed'});await next.close();
  expect(fetch.mock.calls.filter(c=>c[0].endsWith('/embeddings'))).toHaveLength(3);expect(f.calls).toEqual(['cbim_knowledge_search','cbim_knowledge_search']);
  const file=await fs.readFile(bound.data.sessionFile as string,'utf8');expect(file.match(/turn.completed/g)).toHaveLength(2);expect(file).not.toContain('apiKey');
});
test('知识提交后索引失败保留成功工具回执，不重复提交也不自动恢复未完成历史',async()=>{
  const f=await fixture();let vectors=0;const fetch=vi.fn(async(url:string)=>json(url.endsWith('/embeddings')?(++vectors===3?{data:[]}:memoryEmbeddingReply()):memoryChatReply('cbim_object_commit',{planId:'plan'})));vi.stubGlobal('fetch',fetch);
  const engine=f.engine();await engine.start(f.context);await expect(engine.run('更新摘要')).rejects.toThrow('向量索引尚未同步');await engine.close();
  expect(f.calls.filter(name=>name==='cbim_object_commit')).toHaveLength(1);expect(f.events.find(e=>e.type==='tool.finished'&&e.data.name==='cbim_object_commit')?.data.isError).not.toBe(true);
  expect(()=>engine.run('重试')).toThrow('不能重启');const count=fetch.mock.calls.length;
  const bound=f.events.find(e=>e.type==='session.bound')!,next=f.engine();await expect(next.start({...f.context,runId:'next',sessionFile:bound.data.sessionFile as string})).rejects.toThrow('未可靠完成');await next.close();expect(fetch).toHaveBeenCalledTimes(count);
});
test('读取拒绝时不读取知识也不向外部模型发送正文',async()=>{
  const f=await fixture(),fetch=vi.fn();vi.stubGlobal('fetch',fetch);const engine=f.engine();await engine.start({...f.context,beforeTool:async()=>({allow:false,reason:JSON.stringify({message:'本轮禁止读取'})})});
  await expect(engine.run('总结')).rejects.toThrow('本轮禁止读取');await engine.close();expect(f.port.call).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();
});
test('重复模型工具请求只执行一次；总回合有界且不会内部重启',async()=>{
  const f=await fixture(),fetch=vi.fn(async(url:string)=>json(url.endsWith('/embeddings')?memoryEmbeddingReply():memoryChatReply('cbim_knowledge_snapshot')));vi.stubGlobal('fetch',fetch);const engine=f.engine();await engine.start(f.context);
  await expect(engine.run('查看')).rejects.toThrow('重复工具');await engine.close();expect(f.calls.filter(name=>name==='cbim_knowledge_snapshot')).toHaveLength(1);expect(fetch.mock.calls.filter(c=>c[0].endsWith('/chat/completions'))).toHaveLength(2);
});
test('停止中断实际模型请求，关闭等待收口且不再派发工具',async()=>{
  const f=await fixture();let entered!:()=>void;const started=new Promise<void>(resolve=>{entered=resolve});const fetch=vi.fn(async(_url:string,options:RequestInit)=>{entered();return new Promise<Response>((_resolve,reject)=>options.signal!.addEventListener('abort',()=>reject(Error('aborted')),{once:true}))});vi.stubGlobal('fetch',fetch);const engine=f.engine();await engine.start(f.context);const result=engine.run('总结');await started;await engine.stop();expect(await result).toEqual({status:'cancelled'});await engine.close();expect(fetch).toHaveBeenCalledTimes(1);expect(f.calls).toEqual(['cbim_knowledge_search']);
});
test('持续返回不同工具也只允许八次决定，不靠重复检测掩盖无限运行',async()=>{
  const f=await fixture();let count=0;const fetch=vi.fn(async(url:string)=>json(url.endsWith('/embeddings')?memoryEmbeddingReply():memoryChatReply('cbim_knowledge_snapshot',{query:String(++count)})));vi.stubGlobal('fetch',fetch);const engine=f.engine();await engine.start(f.context);
  await expect(engine.run('检查全部来源')).rejects.toThrow('八次模型决定上限');await engine.close();expect(count).toBe(8);expect(f.calls.filter(name=>name==='cbim_knowledge_snapshot')).toHaveLength(8);
});
test('连续无进展会取消实际 HTTP 并给出超时原因',async()=>{
  const f=await fixture(),fetch=vi.fn(async(_url:string,options:RequestInit)=>new Promise<Response>((_resolve,reject)=>{if(options.signal!.aborted)reject(Error('aborted'));else options.signal!.addEventListener('abort',()=>reject(Error('aborted')),{once:true})}));vi.stubGlobal('fetch',fetch);const engine=f.engine(50);await engine.start(f.context);
  await expect(engine.run('总结')).rejects.toThrow('无执行进展');await engine.close();expect(fetch).toHaveBeenCalledTimes(1);
});
