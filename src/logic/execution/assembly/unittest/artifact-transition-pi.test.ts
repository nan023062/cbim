import fs from 'node:fs/promises';
import path from 'node:path';
import {it,expect,vi} from 'vitest';
import {createControlledHost} from '../../../../bridge/server/platform/unittest/support/controlled-file-electron-fixture';
import {completeOutputProvider,completeOutputData as d} from './support/complete-output-provider';
import {completeOutputRecords} from './support/complete-output-pi-fixture';
import {FileRunStorage} from '../../storage/run-storage';
import type {PendingQuestion} from '../../../tools/rules/questions';

// Real Electron utility operations and canonical proofs remain mandatory; only the obsolete dispatch graph is replaced.
it.each(['automatic','changed','human'] as const)('recursive Agent proves real utility delete/move and rechecks original output (%s)',async mode=>{
  const provider=await completeOutputProvider(mode,true,false,true);let host=await createControlledHost(),keep=false;
  try{
    await fs.mkdir('test-results',{recursive:true});
    const seeded=await host.request('seed-transition',{providerUrl:provider.url});provider.bind(seeded.agentId,seeded.moduleId,seeded.selection);
    const entry=seeded.entry,records=()=>completeOutputRecords(host.user,entry.id);
    const start=await host.dispatch('loop.chat',{id:entry.id,message:d.goal,options:{permission:'execute',turnTimeoutMs:60000}});
    const rootDir=path.join(host.user,entry.id,'loop-engine/tasks',start.taskId,start.runId),readRoot=()=>new FileRunStorage().Read(rootDir);
    const questions=()=>host.dispatch('loop.questions',{id:entry.id,taskId:start.taskId}) as Promise<PendingQuestion[]>;
    const until=async(check:()=>Promise<void>|void)=>{await vi.waitFor(async()=>{if(provider.errors.length)return;await check()},{timeout:90000,interval:50});expect(provider.errors).toEqual([])};
    await until(()=>expect(provider.state.readyForReview).toBe(true));
    expect(provider.member).toHaveLength(13);expect(provider.state.manifest.operations).toHaveLength(2);
    expect(provider.state.manifest.entryCount).toBe(4);expect(provider.state.validation.manifest.manifestId).toBe(provider.state.manifest.manifestId);
    const source=path.join(host.project,'outputs/from.txt'),target=path.join(host.project,'outputs/moved.txt'),old=path.join(host.project,'outputs/old.txt');
    await expect(fs.lstat(source)).rejects.toMatchObject({code:'ENOENT'});await expect(fs.lstat(old)).rejects.toMatchObject({code:'ENOENT'});
    expect(await fs.readFile(target,'utf8')).toBe('\uFEFF真实移动源文件\r\n');
    const trace=await host.trace();expect(trace.filter(t=>t.kind==='transition-confirmed')).toHaveLength(2);
    expect(trace.filter(t=>t.kind==='transition-exited').map(t=>t.pid)).toEqual(trace.filter(t=>t.kind==='transition-opened').map(t=>t.pid));
    const ref=provider.state.call.agentCall,childDir=path.join(host.user,entry.id,'loop-engine/tasks',ref.taskId,ref.runId);
    const child=await new FileRunStorage().Read(childDir),childBytes=await fs.readFile(path.join(childDir,'events.jsonl'),'utf8');
    expect(child.status).toBe('completed');expect(child.events.filter(e=>e.type==='artifact.transition_applied')).toHaveLength(2);
    expect((await host.dispatch('dispatch.graphSnapshot',{identity:{workspaceId:entry.id,rootSessionId:start.taskId}})).tasks).toHaveLength(0);
    if(mode==='changed')await fs.writeFile(source,'source returned after move');
    provider.releaseReview();
    if(mode==='human'){
      await until(async()=>expect(await questions()).toHaveLength(1));
      const question=(await questions())[0];expect(question.questions[0].options.map(o=>o.label)).toEqual(['接受此成果','不接受此成果','要求补充证据']);
      await host.dispatch('loop.answerQuestion',{id:entry.id,taskId:start.taskId,questionId:question.id,answers:[{option:0,other:'核实原删除和移动两端'}]});
      await until(async()=>{const list=await questions();expect(list).toHaveLength(1);expect(list[0].id).not.toBe(question.id)});
      const savedRoot=await readRoot(),record=savedRoot.events.find(e=>e.data.phase==='decision_saved')!.data.humanDecision as any;
      expect(record).toMatchObject({callerTaskId:start.taskId,callerRunId:start.runId,callId:'full-call',decision:'accept',original:provider.state.call.verification});
      expect(provider.main).toHaveLength(3);expect(savedRoot.events.some(e=>e.type==='tool.finished'&&e.data.id==='full-human')).toBe(false);
      expect(await fs.readFile(path.join(childDir,'events.jsonl'),'utf8')).toBe(childBytes);
      const continuation=(await questions())[0];
      await host.dispatch('loop.answerQuestion',{id:entry.id,taskId:start.taskId,questionId:continuation.id,answers:[{option:0,other:''}]});
      await until(()=>expect(provider.state.humanReview?.continued).toBe(true));
      expect(provider.state.humanReview).toMatchObject({record,continued:true,executionAuthorized:false});
    }
    await until(async()=>expect((await records()).scopes[0].status).toBe('closed'));
    expect(provider.member).toHaveLength(13);expect(provider.main).toHaveLength(mode==='human'?4:3);
    if(mode==='changed')expect(provider.state.review.error).toBeTruthy();else expect(provider.state.review.state).toBe('verified');
    const rootSummary=await readRoot();
    expect(rootSummary.events.find(e=>e.type==='tool.finished'&&e.data.id==='full-check')?.data.isError??false).toBe(mode==='changed');
    expect(await fs.readFile(path.join(childDir,'events.jsonl'),'utf8')).toBe(childBytes);
    const final=await records(),sequence=[...provider.sequence],rootBytes=await fs.readFile(path.join(rootDir,'events.jsonl'),'utf8'),targetStat=await fs.stat(target);
    const root=host.root;await host.close();host=await createControlledHost({root});
    expect(await records()).toEqual(final);expect(await fs.readFile(path.join(rootDir,'events.jsonl'),'utf8')).toBe(rootBytes);
    expect(await fs.readFile(path.join(childDir,'events.jsonl'),'utf8')).toBe(childBytes);
    expect(provider.sequence).toEqual(sequence);expect(await host.trace()).toEqual([]);expect(await questions()).toEqual([]);
    expect((await fs.stat(target)).mtimeMs).toBe(targetStat.mtimeMs);expect(await fs.readFile(target,'utf8')).toBe('\uFEFF真实移动源文件\r\n');
    await expect(fs.lstat(old)).rejects.toMatchObject({code:'ENOENT'});
    if(mode==='changed')expect(await fs.readFile(source,'utf8')).toBe('source returned after move');else await expect(fs.lstat(source)).rejects.toMatchObject({code:'ENOENT'});
    await fs.writeFile('test-results/artifact-transition-'+mode+'-pi-evidence.json',JSON.stringify({mode,realPi:true,realUtility:true,localDeterministicProvider:true,trace,review:provider.state.review,human:provider.state.humanReview,operations:child.events.filter(e=>e.type.startsWith('artifact.transition_')),requests:{main:provider.main.length,member:provider.member.length},reopenedWithoutReplay:true,canonicalBytesPreserved:true},null,2));
  }catch(error){keep=true;await fs.writeFile('test-results/artifact-transition-'+mode+'-pi-failure.json',JSON.stringify({root:host.root,error:String(error),stack:(error as Error).stack,remoteStack:(error as any).remoteStack,providerErrors:provider.errors,counts:{main:provider.main.length,member:provider.member.length},lastMain:provider.main.at(-1),lastMember:provider.member.at(-1),trace:await host.trace().catch(()=>undefined),diagnostics:host.diagnostics()},null,2));throw error}
  finally{provider.releaseAll();await host.close();await provider.close();if(!keep)await host.remove()}
},240000);

it.each(['source','target'] as const)('rejects stale acceptance after the review opens (%s)',async changed=>{
  const provider=await completeOutputProvider('human',true,false,true,true);let host=await createControlledHost(),keep=false;
  try{
    const seeded=await host.request('seed-transition',{providerUrl:provider.url});provider.bind(seeded.agentId,seeded.moduleId,seeded.selection);
    const entry=seeded.entry,start=await host.dispatch('loop.chat',{id:entry.id,message:d.goal,options:{permission:'execute',turnTimeoutMs:60000}});
    const questions=()=>host.dispatch('loop.questions',{id:entry.id,taskId:start.taskId}) as Promise<PendingQuestion[]>;
    const until=async(check:()=>Promise<void>|void)=>{await vi.waitFor(async()=>{if(provider.errors.length)return;await check()},{timeout:90000,interval:50});expect(provider.errors).toEqual([])};
    await until(()=>expect(provider.state.readyForReview).toBe(true));provider.releaseReview();
    await until(async()=>expect(await questions()).toHaveLength(1));
    const question=(await questions())[0];expect(question.questions[0].options[0].label).toBe('接受此成果');
    const ref=provider.state.call.agentCall,childFile=path.join(host.user,entry.id,'loop-engine/tasks',ref.taskId,ref.runId,'events.jsonl'),before=await fs.readFile(childFile,'utf8');
    const changedFile=path.join(host.project,changed==='source'?'outputs/from.txt':'outputs/moved.txt');await fs.writeFile(changedFile,'externally changed during human review');
    await host.dispatch('loop.answerQuestion',{id:entry.id,taskId:start.taskId,questionId:question.id,answers:[{option:0,other:''}]});
    await until(async()=>expect((await completeOutputRecords(host.user,entry.id)).scopes[0].status).toBe('closed'));
    expect(provider.state.humanReview.error).toBeTruthy();expect(provider.state.humanReview.record).toBeUndefined();
    const rootDir=path.join(host.user,entry.id,'loop-engine/tasks',start.taskId,start.runId),summary=await new FileRunStorage().Read(rootDir);
    expect(summary.events.filter(e=>e.data.humanDecision)).toEqual([]);
    expect(summary.events.find(e=>e.type==='tool.finished'&&e.data.id==='full-human')?.data.isError).toBe(true);
    expect(await questions()).toEqual([]);expect(provider.member).toHaveLength(13);
    expect(await fs.readFile(childFile,'utf8')).toBe(before);expect(await fs.readFile(changedFile,'utf8')).toBe('externally changed during human review');
    const sequence=[...provider.sequence],rootBytes=await fs.readFile(path.join(rootDir,'events.jsonl'),'utf8'),root=host.root;
    await host.close();host=await createControlledHost({root});expect(await fs.readFile(childFile,'utf8')).toBe(before);
    expect(await fs.readFile(path.join(rootDir,'events.jsonl'),'utf8')).toBe(rootBytes);
    expect(provider.sequence).toEqual(sequence);expect(await host.trace()).toEqual([]);
    expect(await fs.readFile(changedFile,'utf8')).toBe('externally changed during human review');
  }catch(error){keep=true;throw error}
  finally{provider.releaseAll();await host.close();await provider.close();if(!keep)await host.remove()}
},240000);
