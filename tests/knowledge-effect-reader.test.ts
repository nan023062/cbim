import {expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fixture} from './helpers';
import {request,moduleFiles} from './data/knowledge';
import {internalKnowledge} from './knowledge-tool-fixture';
import {knowledgeTransactionObservationSchema} from '../src/logic/knowledge/rules/knowledge-write-observation';
import {originalKnowledgeWrite,originalKnowledgeIdentity,type KnowledgeWriteReference} from '../src/logic/knowledge/rules/knowledge-write-input';
import {observeKnowledgeTransaction} from '../src/logic/evidence/service/knowledge-effect-reader';
import {hash,json} from '../src/core/platform/node/serialization';
import {Application} from '../src/bridge/server/application';
import {Paths} from '../src/logic/workspace/service/paths';
import type {KnowledgeGovernanceTransaction,KnowledgeJournalStatus} from '../src/logic/knowledge/storage/governance-port';
import {ObjectCrud} from '../src/logic/knowledge/rules/object-crud';

it('实际工具字段解析与原事务 fingerprint 相同，失败查询不执行或补造请求',async()=>{
 const f=await fixture();try{
  const entry=await f.app.dispatch('add',{path:f.a}),workspace=f.app.workspace(entry.id),snap=await workspace.snapshot(),input={ignored:'PRIVATE_IGNORED',changes:[{text:'真正的知识修改\r\n',path:'.cbim/README.md',ignored:'PRIVATE_NESTED'}],requestId:randomUUID(),revision:snap.revision,instanceId:workspace.instanceId,workspaceId:entry.id};
  const reference=originalKnowledgeWrite('cbim_knowledge_commit',input)!;expect(reference.kind).toBe('request');
  const tools=internalKnowledge(workspace);await tools.service.callFromRun('cbim_knowledge_commit',input,true);
  const file=path.join(f.user,entry.id,'transactions',input.requestId+'.json'),bytes=await fs.readFile(file),journal=JSON.parse(bytes.toString()),commit=vi.spyOn(workspace,'commit'),snapshot=vi.spyOn(workspace,'snapshot');
  const observation=await observeKnowledgeTransaction(workspace,reference);expect(observation).toMatchObject({identity:{workspaceId:entry.id,instanceId:workspace.instanceId,requestId:input.requestId},state:'committed',requestHash:journal.fingerprint,revision:journal.result.revision,changedCount:journal.result.changed.length});
  expect(JSON.stringify(observation)).not.toContain('PRIVATE_');expect(JSON.stringify(observation)).not.toContain('真正的知识修改');expect(await observeKnowledgeTransaction(workspace,reference)).toEqual(observation);expect(await fs.readFile(file)).toEqual(bytes);expect(commit).not.toHaveBeenCalled();expect(snapshot).not.toHaveBeenCalled();
  const wrong=structuredClone(reference);if(wrong.kind==='request')wrong.request.instanceId=randomUUID();expect(await observeKnowledgeTransaction(workspace,wrong)).toMatchObject({state:'unverifiable'});expect(await fs.readFile(file)).toEqual(bytes);
 }finally{vi.restoreAllMocks();await f.cleanup()}
});

it('旧实例完整原请求可在重开后只读核实，新的实例不能借相同 requestId 冒领',async()=>{
 const f=await fixture();let app=f.app;try{
  const entry=await app.dispatch('add',{path:f.a}),workspace=app.workspace(entry.id),input=request(await workspace.snapshot(),[{path:'.cbim/README.md',text:'原请求精确正文\n'}]),reference=originalKnowledgeWrite('cbim_knowledge_commit',input)!;await workspace.commit(input);
  const before=await observeKnowledgeTransaction(workspace,reference),file=path.join(f.user,entry.id,'transactions',input.requestId+'.json'),bytes=await fs.readFile(file);await app.shutdown();app=new Application(new Paths(f.user,path.resolve('.')),path.resolve('design'));await app.init();const reopened=app.workspace(entry.id);expect(reopened.instanceId).not.toBe(input.instanceId);
  expect(await observeKnowledgeTransaction(reopened,reference)).toEqual(before);expect(await fs.readFile(file)).toEqual(bytes);const wrong=originalKnowledgeWrite('cbim_knowledge_commit',{...input,instanceId:reopened.instanceId})!;expect(await observeKnowledgeTransaction(reopened,wrong)).toMatchObject({state:'unverifiable'});
 }finally{await app.shutdown();await f.cleanup()}
});

it('对象提交读取固定原计划和 journal，失去计划或原计划身份改变时不修剪、不补计划',async()=>{
 const f=await fixture();try{
  const entry=await f.app.dispatch('add',{path:f.a}),workspace=f.app.workspace(entry.id);await workspace.commit(request(await workspace.snapshot(),moduleFiles()));
  const objects=new ObjectCrud(workspace),preview=await objects.preview((await workspace.snapshot()).revision,[{kind:'module',action:'update',id:'.cbim/workspace/game',body:moduleFiles()[1].text+'\n原对象提交\n'}]);await objects.commit(preview.planId);
  const input={workspaceId:entry.id,instanceId:workspace.instanceId,planId:preview.planId},ref=originalKnowledgeWrite('cbim_object_commit',input)!;
  const file=path.join(f.user,entry.id,'cache','object-plans',preview.planId+'.json'),bytes=await fs.readFile(file),journal=path.join(f.user,entry.id,'transactions',preview.planId+'.json'),journalBytes=await fs.readFile(journal),prune=vi.spyOn(workspace.objects,'pruneEmpty'),save=vi.spyOn(workspace.objects,'savePlan');
  expect(await observeKnowledgeTransaction(workspace,ref)).toMatchObject({state:'committed',identity:{requestId:preview.planId}});expect(await fs.readFile(file)).toEqual(bytes);expect(await observeKnowledgeTransaction(workspace,{...ref,instanceId:randomUUID()} as KnowledgeWriteReference)).toMatchObject({state:'unverifiable',reason:'original_plan_unavailable'});
  await fs.writeFile(file,'{}');expect(await observeKnowledgeTransaction(workspace,ref)).toMatchObject({state:'unverifiable',reason:'original_plan_unavailable'});expect(await fs.readFile(file,'utf8')).toBe('{}');expect(await fs.readFile(journal)).toEqual(journalBytes);expect(prune).not.toHaveBeenCalled();expect(save).not.toHaveBeenCalled();
 }finally{vi.restoreAllMocks();await f.cleanup()}
});

it('查无原事务及损坏 journal 各保留诊断，不恢复记录或读取今天正文来推测成功',async()=>{
 const f=await fixture();try{
  const entry=await f.app.dispatch('add',{path:f.a}),workspace=f.app.workspace(entry.id),input=request(await workspace.snapshot(),[{path:'.cbim/README.md',text:'知识内容'}]),ref=originalKnowledgeWrite('cbim_knowledge_commit',input)!;
  expect(await observeKnowledgeTransaction(workspace,ref)).toMatchObject({state:'absent',requestHash:hash(json(input))});await workspace.commit(input);const filename=path.join(f.user,entry.id,'transactions',input.requestId+'.json'),journal=JSON.parse(await fs.readFile(filename,'utf8'));journal.fingerprint='0'.repeat(64);const damaged=JSON.stringify(journal);await fs.writeFile(filename,damaged);
  expect(await observeKnowledgeTransaction(workspace,ref)).toMatchObject({state:'unverifiable',reason:'original_record_unverifiable'});expect(await fs.readFile(filename,'utf8')).toBe(damaged);
 }finally{await f.cleanup()}
});

const reference:KnowledgeWriteReference={kind:'request',request:{workspaceId:'workspace',instanceId:randomUUID(),requestId:randomUUID(),revision:'old',changes:[]}};
it.each(['prepared','committing','rolled_back','recovery_required'] as const)('只读端口投影保留 %s，不当作 committed 或未执行',async state=>{
 const journal=vi.fn(async():Promise<KnowledgeJournalStatus>=>({state,before:{},after:{}})),entered=vi.fn(),governed=async<T,>(operation:(tx:Pick<KnowledgeGovernanceTransaction,'journal'>)=>Promise<T>)=>{entered();return operation({journal})};
 const owner={entry:{id:'workspace'},paths:{} as Paths,assert:vi.fn(),governed},result=await observeKnowledgeTransaction(owner,reference);
 expect(result).toMatchObject({identity:originalKnowledgeIdentity(reference),state,requestHash:hash(json(reference.request)),evidenceHash:expect.any(String)});expect(result.revision).toBeUndefined();expect(result.changedCount).toBeUndefined();expect(journal).toHaveBeenCalledTimes(1);expect(entered).toHaveBeenCalledTimes(1);
});
it('阶段与回执不匹配拒绝为证据，停止不进入知识队列',async()=>{
 const identity=originalKnowledgeIdentity(reference);for(const bad of [{identity,state:'committed',requestHash:'a'.repeat(64),evidenceHash:'b'.repeat(64)},{identity,state:'absent',requestHash:'a'.repeat(64),evidenceHash:'b'.repeat(64)},{identity,state:'unverifiable'},{identity,state:'rolled_back',requestHash:'a'.repeat(64),evidenceHash:'b'.repeat(64),revision:'wrong',changedCount:1}])expect(knowledgeTransactionObservationSchema.safeParse(bad).success).toBe(false);
 const governed=vi.fn(),owner={entry:{id:'workspace'},paths:{} as Paths,assert:vi.fn(),governed},controller=new AbortController();controller.abort(Error('explicit stop'));await expect(observeKnowledgeTransaction(owner,reference,controller.signal)).rejects.toThrow('explicit stop');expect(governed).not.toHaveBeenCalled();expect(originalKnowledgeWrite('cbim_knowledge_refresh',{workspaceId:'workspace',instanceId:reference.request.instanceId})).toBeUndefined();expect(originalKnowledgeWrite('cbim_object_commit',{workspaceId:'workspace',instanceId:reference.request.instanceId,planId:'../../outside'})).toBeUndefined();
});
