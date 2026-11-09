import {it,expect,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {Application} from '../src/backend/main/application';
import {Paths} from '../src/backend/main/platform/paths';
import {knowledgeSourceChangeSchema,type KnowledgeSourceChange} from '../src/backend/core/workspace/knowledge-source';
import {fixture,summary} from './helpers';
import {seedKnowledgeSource,knowledgeSourceFixture as data,knowledgeSourceDiskEvidence,knowledgeSourceHttpProbe,knowledgeSourceMemberChange} from './knowledge-source-lifecycle-fixture';

it.each(['prepare-reply-lost','final-not-saved','final-reply-lost'] as const)('actual Application recovers only the original knowledge/source handshake after %s',async mode=>{
  const f=await fixture(),probe=await knowledgeSourceHttpProbe();let app=f.app;
  try{
    const call=(action:string,input?:unknown)=>app.dispatch(action,input),seeded=await seedKnowledgeSource(call,f.temp,probe.url),id=seeded.entry.id,workspace=app.workspace(id),coordinator=workspace.sources;
    if(!coordinator)throw Error('Actual Application did not attach its unique source coordinator');
    const snapshot=await workspace.snapshot(),input={workspaceId:id,instanceId:workspace.instanceId,revision:snapshot.revision,operations:[{kind:'agent',action:'create',parentId:'.cbim/team',slug:'fault_worker',data:{name:'原事务故障验证',summary,capabilities:['核实']},body:'# 真实持久写入\n\n只核实原事务，不自动重做。'}]};
    const preview=await call('architecture.preview',input);expect(preview.validation.structural).toBe(true);const commitInput={workspaceId:id,instanceId:workspace.instanceId,planId:preview.planId};
    const file=path.join(seeded.project,'.cbim/team/fault_worker/principles.md'),journalPath=path.join(f.user,id,'transactions',preview.planId+'.json');
    const realPrepare=coordinator.prepare.bind(coordinator),realSettle=coordinator.settle.bind(coordinator);
    if(mode==='prepare-reply-lost')vi.spyOn(coordinator,'prepare').mockImplementationOnce(async source=>{await realPrepare(source);throw Error('TEST_SOURCE_PREPARE_REPLY_LOST_AFTER_REAL_PERSIST')});
    else vi.spyOn(coordinator,'settle').mockImplementationOnce(async(...args)=>{if(mode==='final-reply-lost')await realSettle(...args);throw Error(mode==='final-not-saved'?'TEST_SOURCE_FINAL_UNAVAILABLE':'TEST_SOURCE_FINAL_REPLY_LOST_AFTER_REAL_PERSIST')});
    if(mode==='prepare-reply-lost')await expect(call('architecture.commit',commitInput)).rejects.toThrow('TEST_SOURCE_PREPARE_REPLY_LOST_AFTER_REAL_PERSIST');else await expect(call('architecture.commit',commitInput)).rejects.toMatchObject({code:'SOURCE_FINAL_PENDING'});
    const journal=JSON.parse(await fs.readFile(journalPath,'utf8'));expect(journal.source.request).toEqual(preview.request);expect(journal.source.transition.requestId).toBe(preview.planId);
    expect(journal.state).toBe(mode==='prepare-reply-lost'?'prepared':'committed');expect((await coordinator.pending()).map(value=>value.requestId)).toEqual(mode==='final-reply-lost'?[]:[preview.planId]);
    let written:Buffer|undefined,mtime:number|undefined;
    if(mode==='prepare-reply-lost'){await expect(fs.stat(file)).rejects.toMatchObject({code:'ENOENT'});expect((await workspace.snapshot()).files).toEqual(snapshot.files)}
    else{written=await fs.readFile(file);mtime=(await fs.stat(file)).mtimeMs;expect(written.toString('utf8')).toContain('真实持久写入');expect(journal.result.state).toBe('committed')}
    if(mode!=='final-reply-lost'){
      await expect(knowledgeSourceMemberChange(call,id,{kind:'adopt',memberId:seeded.registered.receipt.memberId,expectedRevision:1,target:'capability',reason:data.reason})).rejects.toMatchObject({code:'MEMBER_SOURCE_PENDING'});
      // A harmless name change remains available without silently adopting or resolving the pending knowledge transaction.
      await knowledgeSourceMemberChange(call,id,{kind:'update',memberId:seeded.registered.receipt.memberId,expectedRevision:1,patch:{name:data.memberName+'（保留旧来源）'},reason:'待核实期间仅调整岗位名称'});
      expect((await coordinator.pending()).map(value=>value.requestId)).toEqual([preview.planId]);
    }
    vi.restoreAllMocks();const beforeRestart=await knowledgeSourceDiskEvidence(f.user,id);await app.shutdown();app=new Application(new Paths(f.user,path.resolve('.')),path.resolve('design'));await app.init();
    expect(app.workspace(id).state).toBe('running');expect(await app.workspace(id).sources!.pending()).toEqual([]);
    const recovered=JSON.parse(await fs.readFile(journalPath,'utf8'));expect(recovered.state).toBe(mode==='prepare-reply-lost'?'rolled_back':'committed');
    const currentIdentity={workspaceId:id,instanceId:app.workspace(id).instanceId,planId:preview.planId};
    if(mode==='prepare-reply-lost'){await expect(fs.stat(file)).rejects.toMatchObject({code:'ENOENT'});await expect(call('architecture.commit',currentIdentity)).rejects.toMatchObject({code:'RECOVERY'})}
    else{expect(await fs.readFile(file)).toEqual(written);expect((await fs.stat(file)).mtimeMs).toBe(mtime);expect(recovered).toEqual(journal);expect((await call('architecture.commit',currentIdentity)).requestId).toBe(preview.planId)}
    const recoveredDisk=await knowledgeSourceDiskEvidence(f.user,id),sourceEvents:KnowledgeSourceChange[]=recoveredDisk.dispatchBytes.toString('utf8').split('\n').filter(Boolean).flatMap(line=>{const value=JSON.parse(line);return (value.body.mutation.knowledgeSourceChanges??[]).map((item:unknown)=>knowledgeSourceChangeSchema.parse(item))});
    const transitionId=journal.source.transition.transitionId;
    expect(sourceEvents.filter(value=>value.kind==='prepared'&&value.transition.transitionId===transitionId)).toHaveLength(1);
    expect(sourceEvents.filter(value=>value.kind==='resolved'&&value.transitionId===transitionId)).toHaveLength(1);
    if(mode==='final-reply-lost')expect(recoveredDisk.dispatchBytes).toEqual(beforeRestart.dispatchBytes);
    const transitions=await app.workspace(id).sources!.transitions();expect(transitions.filter(value=>value.transitionId===transitionId)).toHaveLength(1);expect(transitions.find(value=>value.transitionId===transitionId)!.state).toBe(mode==='prepare-reply-lost'?'rolled_back':'committed');
    const afterRetry=await knowledgeSourceDiskEvidence(f.user,id);await app.shutdown();app=new Application(new Paths(f.user,path.resolve('.')),path.resolve('design'));await app.init();expect((await knowledgeSourceDiskEvidence(f.user,id)).dispatchBytes).toEqual(afterRetry.dispatchBytes);expect(probe.requests).toEqual([]);
  }finally{vi.restoreAllMocks();await app.shutdown();await f.cleanup();await probe.close()}
},90000);

it.each([false,true])('a genuine prepared journal without DS admission never overwrites an external after-image on reopen (external change=%s)',async externalChange=>{
  const f=await fixture(),probe=await knowledgeSourceHttpProbe();let app=f.app;
  try{
    const call=(action:string,input?:unknown)=>app.dispatch(action,input),seeded=await seedKnowledgeSource(call,f.temp,probe.url),id=seeded.entry.id,workspace=app.workspace(id),coordinator=workspace.sources;
    if(!coordinator)throw Error('Actual source coordinator absent');
    const snapshot=await workspace.snapshot(),relative=data.agentId+'/principles.md',file=path.join(seeded.project,...relative.split('/'));
    const preview=await call('architecture.preview',{workspaceId:id,instanceId:workspace.instanceId,revision:snapshot.revision,operations:[{kind:'agent',action:'update',id:data.agentId,body:data.changedPrinciples}]});expect(preview.validation.structural).toBe(true);
    vi.spyOn(coordinator,'prepare').mockImplementationOnce(async()=>{throw Error('TEST_BEFORE_SOURCE_PENDING')});
    await expect(call('architecture.commit',{workspaceId:id,instanceId:workspace.instanceId,planId:preview.planId})).rejects.toThrow('TEST_BEFORE_SOURCE_PENDING');
    const journalPath=path.join(f.user,id,'transactions',preview.planId+'.json'),journalBytes=await fs.readFile(journalPath),journal=JSON.parse(journalBytes.toString('utf8'));
    expect(journal.state).toBe('prepared');expect(journal.source.request).toEqual(preview.request);expect(await coordinator.pending()).toEqual([]);expect((await coordinator.transitions()).some(value=>value.requestId===preview.planId)).toBe(false);expect(await fs.readFile(file,'utf8')).toBe(data.principles);
    const dispatchBefore=(await knowledgeSourceDiskEvidence(f.user,id)).dispatchBytes;
    vi.restoreAllMocks();await app.shutdown();
    if(externalChange){expect(journal.after[relative]).toBe(data.changedPrinciples);await fs.writeFile(file,journal.after[relative],'utf8')}
    const expectedBytes=await fs.readFile(file),expectedMtime=(await fs.stat(file)).mtimeMs;
    app=new Application(new Paths(f.user,path.resolve('.')),path.resolve('design'));await app.init();
    expect(await fs.readFile(file)).toEqual(expectedBytes);expect((await fs.stat(file)).mtimeMs).toBe(expectedMtime);expect((await knowledgeSourceDiskEvidence(f.user,id)).dispatchBytes).toEqual(dispatchBefore);
    const recovered=JSON.parse(await fs.readFile(journalPath,'utf8'));
    if(externalChange){expect(app.workspace(id).state).toBe('failed');expect(recovered.state).not.toBe('rolled_back');expect(recovered.before).toEqual(journal.before);expect(recovered.after).toEqual(journal.after)}
    else{expect(app.workspace(id).state).toBe('running');expect(recovered.state).toBe('rolled_back')}
    expect(probe.requests).toEqual([]);
  }finally{vi.restoreAllMocks();await app.shutdown();await f.cleanup();await probe.close()}
},90000);
