import {expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fixture} from './helpers';
import {internalKnowledge} from './knowledge-tool-fixture';
import {moduleFiles} from './data/knowledge';
import {originalKnowledgeWrite} from '../src/backend/core/knowledge/knowledge-write-input';
import {observeKnowledgeTransaction} from '../src/backend/main/workspace/knowledge-effect-reader';
import {artifactRuntimeFixture} from './artifact-runtime-fixture';

it('v2刷新按原版本提交派生索引，重复不写，异参、旧版、陈旧版本和取消均不新建事务',async()=>{
 const f=await fixture();try{
  const entry=await f.app.dispatch('add',{path:f.a}),ws=f.app.workspace(entry.id),{call,service,identity}=internalKnowledge(ws),index=path.join(f.a,'.cbim/workspace/registry.json');
  const originalIndex=await fs.readFile(index);for(const file of moduleFiles()){const dest=path.join(f.a,file.path);await fs.mkdir(path.dirname(dest),{recursive:true});await fs.writeFile(dest,file.text)}
  const input={...identity,revision:(await ws.snapshot()).revision,requestId:randomUUID()},commit=vi.spyOn(ws,'commit');
  expect((await call('cbim_knowledge_tool_describe',{name:'cbim_knowledge_refresh'})).tool).toMatchObject({version:2,inputSchema:{required:expect.arrayContaining(['revision','requestId'])},recovery:{mode:'same_request'}});
  await expect(call('cbim_knowledge_refresh',{},true)).rejects.toThrow();expect(commit).not.toHaveBeenCalled();
  await expect(call('cbim_knowledge_refresh',{...input,revision:'old'},true)).rejects.toMatchObject({code:'CONFLICT'});expect(commit).not.toHaveBeenCalled();
  const stopped=new AbortController();stopped.abort(Error('explicit stop'));await expect(service.callFromRun('cbim_knowledge_refresh',input,true,stopped.signal)).rejects.toThrow('explicit stop');expect(commit).not.toHaveBeenCalled();
  const result=await call('cbim_knowledge_refresh',input,true);expect(result).toMatchObject({state:'refreshed',indexesUpdated:true});expect(commit).toHaveBeenCalledTimes(1);expect(commit.mock.calls[0][0]).toEqual({...input,changes:[]});expect(await fs.readFile(index)).not.toEqual(originalIndex);
  const file=path.join(f.user,entry.id,'transactions',input.requestId+'.json'),bytes=await fs.readFile(file),reference=originalKnowledgeWrite('cbim_knowledge_refresh',input,2)!;
  expect(await observeKnowledgeTransaction(ws,reference)).toMatchObject({state:'committed',identity:{requestId:input.requestId}});expect(await call('cbim_knowledge_refresh',input,true)).toMatchObject({indexesUpdated:true});expect(commit).toHaveBeenCalledTimes(1);expect(await fs.readFile(file)).toEqual(bytes);
  await expect(call('cbim_knowledge_refresh',{...input,revision:result.revision},true)).rejects.toThrow();expect(await fs.readFile(file)).toEqual(bytes);expect(commit).toHaveBeenCalledTimes(1);
  expect(originalKnowledgeWrite('cbim_knowledge_refresh',input)).toBeUndefined();expect(originalKnowledgeWrite('cbim_knowledge_refresh',input,1)).toBeUndefined();
 }finally{vi.restoreAllMocks();await f.cleanup()}
});

it('契约版本只来自可信描述，伪造引擎事件及调用顶层/参数版本不能污染授权',async()=>{
 const f=await artifactRuntimeFixture(async c=>{
  await c.emit({type:'engine.status',data:{contractVersion:99}});
  const call={id:'version-call',name:'read',input:{contractVersion:99},contractVersion:99};await c.beforeTool(call);await c.emit({type:'tool.finished',data:{id:call.id,name:call.name,contractVersion:99,result:'read',isError:false}});
 },{describeTool:()=>({effects:['read'],native:true,contractVersion:2})});
 try{const result=await(await f.start()).done;expect(result.status).toBe('completed');const events=result.events.filter(e=>e.data.contractVersion!==undefined);expect(events).toHaveLength(1);expect(events[0]).toMatchObject({type:'tool.allowed',data:{contractVersion:2,input:{contractVersion:99}}})}finally{await f.cleanup()}
});
