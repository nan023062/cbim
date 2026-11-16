import {it,expect} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {prepareRecursivePause} from './recursive-pause-fixture';
import {registerFixtureOwner} from './owner-execution-fixture';
import {memberCheckpointFixture as data} from './member-checkpoint-provider';

it.each(['complete','owner-before-answer','model-after-answer'] as const)('keeps the paused owner binding and does not silently change the next call (%s)',async mode=>{
 const c=await prepareRecursivePause(false,mode==='model-after-answer');
 try{
  const original=(await c.state()).agentBusinessRuns![0],binding=original.prepared.memberContext!.binding,moduleId=original.prepared.modules[0].binding.moduleId;
  const first=await c.child(),marker=(await fs.stat(path.join(c.f.a,data.files[0]))).mtimeMs;
  if(mode==='owner-before-answer'){
   const replacement=await registerFixtureOwner(c.app,c.entry.id,{agentId:binding.capability.agentId,moduleIds:[moduleId],profileId:binding.model.profileId,modelId:binding.model.modelId,name:'显式替换岗位',adaptation:{instructions:'新的岗位配置不接管运行中的原调用',references:[moduleId]}});
   expect(replacement.member.memberId).not.toBe(binding.memberId);
  }
  await c.answer(c.first);
  if(mode==='model-after-answer'){
   await c.until(()=>expect(c.provider.state.continued).toBe(true));
   await c.app.models.Save({id:binding.model.profileId,profile:{name:'Member checkpoint fixture',api:'openai-completions',baseUrl:c.provider.url,auth:'none',defaultModel:data.model,models:[{id:data.model,name:'Member checkpoint fixture',enabled:true,contextWindow:65536,maxTokens:2048,reasoning:false,pricing:{input:0,output:0,cacheRead:0,cacheWrite:0}}]}});
   c.provider.releaseContinuation();
  }
  await c.until(async()=>{expect((await c.state()).scopes?.[0].status).toBe('closed');expect(c.app.runtime.Snapshot().pressure.activeRuns).toBe(0)});
  const saved=await c.state(),runs=saved.agentBusinessRuns!,child=await c.child();
  expect(runs).toHaveLength(mode==='complete'?3:1);expect(runs[0].binding).toEqual(original.binding);expect(runs[0].prepared).toEqual(original.prepared);
  expect(child.task.ownerBinding).toEqual(binding);expect(child.sessionFile).toBe(first.sessionFile);
  expect(child.events.filter(e=>e.type==='run.started')).toHaveLength(1);
  expect(child.toolReceipts?.filter(r=>r.toolName==='write'&&r.outcome==='succeeded')).toHaveLength(1);
  expect((await fs.stat(path.join(c.f.a,data.files[0]))).mtimeMs).toBe(marker);
  for(const request of c.provider.byChild[0]){const body=request as unknown as {max_tokens?:number;max_completion_tokens?:number};expect(body.max_tokens??body.max_completion_tokens).toBe(4096)}
  if(mode==='complete')expect(c.provider.state.results.every(r=>r.verification?.state==='verified')).toBe(true);
  else if(mode==='model-after-answer'){expect(c.provider.state.result.verification.state).toBe('verified');expect(c.provider.state.results[1].error.code).toBe('AGENT_CONFIGURATION_CHANGED')}
  else{expect(c.provider.state.result.verification.state).toBe('verified');expect(c.provider.state.results[1].error.code).toBe('AGENT_BUSINESS_OWNER')}
  if(mode!=='complete')expect(c.provider.byChild.slice(1)).toEqual([[],[]]);
  expect(saved.graphs[0].tasks).toEqual([]);
  const canonical=await fs.readFile(path.join(c.directory,'events.jsonl')),native=await fs.readFile(child.sessionFile!),sequence=[...c.provider.sequence];
  await c.reopen();expect(await c.state()).toEqual(saved);expect(c.provider.sequence).toEqual(sequence);
  expect(await fs.readFile(path.join(c.directory,'events.jsonl'))).toEqual(canonical);expect(await fs.readFile(child.sessionFile!)).toEqual(native);
 }finally{await c.cleanup()}
},90000);
