import {governanceCommandReceipts} from '../src/bridge/contracts/ipc-governance';
import {required} from './helpers';
import {it,expect,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fixture} from './helpers';
import {request,moduleFiles} from './data/knowledge';
import {seedModuleGovernance,moduleGovernanceFixture as data} from './module-governance-fixture';
import {WorkspacePackages} from '../src/backend/main/resources/workspace-packages';
import {ArchitectureService} from '../src/backend/main/workspace/architecture-service';
import {moduleGovernanceReceiptSchema,type ModuleGovernanceReceipt} from '../src/backend/core/governance/module-governance';
import {json} from '../src/backend/core/foundation/serialization';

async function setup(){const f=await fixture();try{
  const seeded=await seedModuleGovernance(f.app,f.a),ws=f.app.workspace(seeded.entry.id),identity=seeded.identity;
  const call=async<A extends ModuleGovernanceReceipt['action']>(action:A,input:object)=>{const parsed=moduleGovernanceReceiptSchema.parse(await f.app.dispatch('governance.'+action,{...identity,...input}));if(parsed.action!==action)throw Error('action');return parsed as Extract<ModuleGovernanceReceipt,{action:A}>};
  const registration=await call('register',{commandId:randomUUID(),moduleId:data.moduleId,expectedKnowledgeRevision:seeded.snapshot.revision}),protection=registration.record;
  const observed=await call('observe',{commandId:randomUUID(),protectionId:protection.protectionId,expectedProtectionRevision:1,expectedKnowledgeRevision:seeded.snapshot.revision,statement:'服务测试的明确观察'});
  const proposed=await call('propose',{commandId:randomUUID(),protectionId:protection.protectionId,observationId:observed.record.observationId,expectedProtectionRevision:1,expectedKnowledgeRevision:seeded.snapshot.revision,newOverviewText:seeded.proposed,reason:data.reason,alternatives:[data.alternative],invariants:[data.invariant],rollbackNotes:data.recovery}),proposal=proposed.record;
  const approve=()=>call('decide',{commandId:randomUUID(),proposalId:proposal.proposalId,expectedDecisionRevision:0,expectedBasis:proposal.basis,decision:'approve',comment:'批准本次精确差异'});
  const applyInput=(decisionId:string)=>({...identity,commandId:randomUUID(),proposalId:proposal.proposalId,decisionId,expectedBasis:proposal.basis});
  return {...f,...seeded,ws,call,protection,proposal,approve,applyInput,ledger:path.join(f.user,seeded.entry.id,'governance','module-ledger.json')};
}catch(error){await f.cleanup();throw error}}

it('所有真实知识入口共用保护：ignore、改定义、移动、架构编辑和整包替换均被拒',async()=>{
  const f=await setup();try{
    const before=await f.ws.snapshot();
    await expect(f.ws.commit(request(before,[{path:'.cbim/.cbimignore',text:data.moduleId+'/\n'}]))).rejects.toMatchObject({code:'GOVERNANCE_PROTECTED'});
    await expect(f.ws.commit(request(before,[{path:data.moduleId+'/module.json',text:json({...f.definition,summary:f.definition.summary+'调整。'})}]))).rejects.toMatchObject({code:'GOVERNANCE_PROTECTED'});
    const moved=await f.ws.planMove(before,data.moduleId,'.cbim/workspace/moved');await expect(f.ws.commit(moved)).rejects.toMatchObject({code:'GOVERNANCE_PROTECTED'});
    const arch=new ArchitectureService(f.ws),plan=await arch.preview({...f.identity,revision:before.revision,operations:[{kind:'module',action:'delete',id:data.moduleId}]});await expect(arch.commit({...f.identity,planId:plan.planId})).rejects.toMatchObject({code:'GOVERNANCE_PROTECTED'});
    await fs.mkdir(path.join(f.temp,'repository'));
    const other=await f.app.dispatch('add',{path:f.b}),source=f.app.workspace(other.id);await source.commit(request(await source.snapshot(),moduleFiles('replacement')));await f.app.resources.configure({mode:'local',location:path.join(f.temp,'repository')});const repo=await f.app.resources.read(),published=await new WorkspacePackages(source,f.app.resources).publish({workspaceId:other.id,instanceId:source.instanceId,revision:(await source.snapshot()).revision,repositoryId:repo.repositoryId,repositoryRevision:repo.revision,kind:'architecture',name:'真实替换模板',summary:'测试完整架构替换'}),target=new WorkspacePackages(f.ws,f.app.resources),currentRepo=await f.app.resources.read();
    const imported=await target.preview({...f.identity,revision:before.revision,repositoryId:currentRepo.repositoryId,repositoryRevision:currentRepo.revision,resourceId:published.resourceId,mode:'replace'});await expect(target.commit({...f.identity,planId:imported.planId})).rejects.toMatchObject({code:'GOVERNANCE_PROTECTED'});
    expect((await f.ws.snapshot()).files).toEqual(before.files);
  }finally{await f.cleanup()}
});

it('决定 CAS 与实施共用串行队列，后到拒绝获胜后旧批准不能实施；重复命令不覆盖',async()=>{
  const f=await setup();try{
    const approved=await f.approve(),reject={commandId:randomUUID(),proposalId:f.proposal.proposalId,expectedDecisionRevision:1,expectedBasis:f.proposal.basis,decision:'reject',comment:'新的明确意见'};
    const [one,two]=await Promise.allSettled([f.call('decide',reject),f.call('decide',{...reject,commandId:randomUUID(),comment:'并发意见'})]);expect(one.status).toBe('fulfilled');expect(two.status).toBe('rejected');if(two.status==='rejected')expect(two.reason.code).toBe('GOVERNANCE_STALE');
    await expect(f.app.dispatch('governance.apply',f.applyInput(approved.record.decisionId))).rejects.toMatchObject({code:'GOVERNANCE_DECISION'});
    await expect(f.call('decide',{...reject,comment:'变更同命令'})).rejects.toMatchObject({code:'GOVERNANCE_COMMAND_CONFLICT'});expect(await fs.readFile(path.join(f.a,f.overviewPath),'utf8')).toBe(f.original);
  }finally{await f.cleanup()}
});

it('apply意图写失败不开始知识事务；原意图持久但未提交在重开后明确not_applied',async()=>{
  const f=await setup();try{
    const approved=await f.approve(),input=f.applyInput(approved.record.decisionId),append=vi.spyOn(f.ws.governance.store,'append').mockRejectedValueOnce(Object.assign(Error('disk'),{code:'EIO'}));
    await expect(f.app.dispatch('governance.apply',input)).rejects.toMatchObject({code:'EIO'});append.mockRestore();expect(await f.app.dispatch('governance.receipt',{workspaceId:f.entry.id,commandId:input.commandId})).toBeUndefined();await expect(fs.stat(path.join(f.user,f.entry.id,'transactions',input.commandId+'.json'))).rejects.toMatchObject({code:'ENOENT'});
    const blocked=vi.spyOn(f.ws.governance,'request').mockRejectedValueOnce(Error('crash after durable intent'));
    await expect(f.app.dispatch('governance.apply',input)).rejects.toMatchObject({code:'GOVERNANCE_APPLY_UNKNOWN'});blocked.mockRestore();expect(governanceCommandReceipts.apply.parse((await f.app.dispatch('governance.receipt',{workspaceId:f.entry.id,commandId:input.commandId}))).record.state).toBe('pending');
    await f.app.open(f.entry.id,true);const current=f.app.workspace(f.entry.id),receipt=await f.app.dispatch('governance.receipt',{workspaceId:f.entry.id,commandId:input.commandId});expect(governanceCommandReceipts.apply.parse(receipt).record.state).toBe('not_applied');expect(await fs.readFile(path.join(f.a,f.overviewPath),'utf8')).toBe(f.original);
    const newInput={...input,instanceId:current.instanceId,commandId:randomUUID()},completed=await f.app.dispatch('governance.apply',newInput);expect(completed.record.state).toBe('committed');expect(governanceCommandReceipts.apply.parse((await f.app.dispatch('governance.receipt',{workspaceId:f.entry.id,commandId:input.commandId}))).record.state).toBe('not_applied');
  }finally{vi.restoreAllMocks();await f.cleanup()}
});

it('首文件故障回滚，已commit后的响应错误仍只读核实原journal并不再执行',async()=>{
  const f=await setup();try{
    const approved=await f.approve(),input=f.applyInput(approved.record.decisionId);(f.ws as any).fault=()=>{throw Error('write interrupted')};
    const rolled=await f.app.dispatch('governance.apply',input);expect(rolled.record.state).toBe('rolled_back');expect(await fs.readFile(path.join(f.a,f.overviewPath),'utf8')).toBe(f.original);(f.ws as any).fault=undefined;
    const store=(f.ws as any).knowledge,commit=store.commitInternal.bind(store),spy=vi.spyOn(store,'commitInternal').mockImplementation(async(...args:any[])=>{await commit(...args);throw Error('lost response after committed journal')});
    const second=f.applyInput(approved.record.decisionId),done=await f.app.dispatch('governance.apply',second);expect(done.record.state).toBe('committed');expect(spy).toHaveBeenCalledTimes(1);expect(await f.app.dispatch('governance.apply',second)).toEqual(done);expect(spy).toHaveBeenCalledTimes(1);spy.mockRestore();
    await f.app.open(f.entry.id,true);expect(await f.app.dispatch('governance.receipt',{workspaceId:f.entry.id,commandId:second.commandId})).toEqual(done);expect(await fs.readFile(path.join(f.a,f.overviewPath),'utf8')).toBe(f.proposed);
  }finally{vi.restoreAllMocks();await f.cleanup()}
});

it('账本或原journal关联损坏不得伪造成功；同串行屏障仅证明旧实例完全无命令',async()=>{
  const f=await setup();try{
    const approved=await f.approve(),input=f.applyInput(approved.record.decisionId),done=await f.app.dispatch('governance.apply',input);expect(done.record.state).toBe('committed');
    const unknown=randomUUID();expect((await f.app.dispatch('governance.unaccepted',{...f.identity,commandId:unknown,action:'apply'})).unaccepted).toBe(false);
    await f.app.open(f.entry.id,true);expect((await f.app.dispatch('governance.unaccepted',{...f.identity,commandId:unknown,action:'apply'})).unaccepted).toBe(true);expect((await f.app.dispatch('governance.unaccepted',{...f.identity,commandId:input.commandId,action:'apply'})).unaccepted).toBe(false);
    const journalPath=path.join(f.user,f.entry.id,'transactions',input.commandId+'.json'),bytes=await fs.readFile(journalPath,'utf8'),journal=JSON.parse(bytes);delete journal.governance;await fs.writeFile(journalPath,json(journal));await expect(f.app.dispatch('governance.receipt',{workspaceId:f.entry.id,commandId:input.commandId})).rejects.toMatchObject({code:'GOVERNANCE_DATA'});await fs.writeFile(journalPath,bytes);
    for(const [mutate,code] of [
      [(value:any)=>{value.after[f.overviewPath]='wrong bytes'},'RECOVERY'],
      [(value:any)=>{value.before[f.overviewPath]='wrong baseline'},'SOURCE_JOURNAL_INVALID'],
      [(value:any)=>{value.result.changed=[]},'RECOVERY'],
    ] as const){const changed=JSON.parse(bytes);mutate(changed);await fs.writeFile(journalPath,json(changed));await expect(f.app.dispatch('governance.receipt',{workspaceId:f.entry.id,commandId:input.commandId})).rejects.toMatchObject({code});await fs.writeFile(journalPath,bytes)}
    await f.app.stop(f.entry.id);const ledger=JSON.parse(await fs.readFile(f.ledger,'utf8'));ledger.commands=ledger.commands.filter((command:any)=>command.receipt.action!=='register');await fs.writeFile(f.ledger,json(ledger));await expect(f.app.open(f.entry.id)).rejects.toMatchObject({code:'GOVERNANCE_DATA'});expect(f.app.workspace(f.entry.id).state).toBe('failed');
  }finally{await f.cleanup()}
});

it('账本已写而完整性锚确认失败时本实例拒绝继续，重开只恢复原观察不执行知识',async()=>{
  const f=await setup();try{
    const commandId=randomUUID(),before=(await f.ws.snapshot()).revision,original=fs.rename.bind(fs);let count=0;
    const rename=vi.spyOn(fs,'rename').mockImplementation(async(from,to)=>{if(String(to)===f.ledger+'.anchor'&&++count===2)throw Object.assign(Error('anchor confirmation failed'),{code:'EIO'});return original(from,to)});
    await expect(f.call('observe',{commandId,protectionId:f.protection.protectionId,expectedProtectionRevision:1,expectedKnowledgeRevision:before,statement:'保存后失联的原观察'})).rejects.toMatchObject({code:'EIO'});rename.mockRestore();
    await expect(f.ws.commit(request(await f.ws.snapshot(),[{path:f.overviewPath,text:f.proposed}]))).rejects.toMatchObject({code:'GOVERNANCE_DATA'});
    await f.app.open(f.entry.id,true);const receipt=await f.app.dispatch('governance.receipt',{workspaceId:f.entry.id,commandId});expect(required(receipt).action).toBe('observe');expect(governanceCommandReceipts.observe.parse(receipt).record.statement).toBe('保存后失联的原观察');expect((await f.app.workspace(f.entry.id).snapshot()).revision).toBe(before);
    const anchor=JSON.parse(await fs.readFile(f.ledger+'.anchor','utf8'));expect(anchor.pending).toBeUndefined();expect(anchor.head.revision).toBe(JSON.parse(await fs.readFile(f.ledger,'utf8')).commands.length);
  }finally{vi.restoreAllMocks();await f.cleanup()}
});

it('治理实施已进入知识门禁后重启等待原提交，新调用仍被关闭态拒绝',async()=>{
  const f=await setup();let release!:()=>void;
  try{
    const approved=await f.approve(),input=f.applyInput(approved.record.decisionId);let entered!:()=>void;
    const waiting=new Promise<void>(resolve=>{entered=resolve}),gate=new Promise<void>(resolve=>{release=resolve}),verify=f.ws.governance.verify.bind(f.ws.governance);
    const spy=vi.spyOn(f.ws.governance,'verify').mockImplementation(async(...args)=>{if(args[4]){entered();await gate}return verify(...args)});
    const applying=f.app.dispatch('governance.apply',input);await waiting;const restarting=f.app.open(f.entry.id,true);
    try{for(let count=0;count<100&&f.ws.state!=='closing';count++)await new Promise(resolve=>setTimeout(resolve,1));expect(f.ws.state).toBe('closing');await expect(f.ws.commit(request(f.snapshot,[{path:'.cbim/README.md',text:'# late'}]))).rejects.toMatchObject({code:'NOT_RUNNING'})}finally{release()}
    const receipt=await applying;expect(receipt.record.state).toBe('committed');await restarting;spy.mockRestore();
    expect(await fs.readFile(path.join(f.a,f.overviewPath),'utf8')).toBe(f.proposed);expect(await f.app.dispatch('governance.receipt',{workspaceId:f.entry.id,commandId:input.commandId})).toEqual(receipt);
    expect(f.app.workspace(f.entry.id).instanceId).not.toBe(f.identity.instanceId);
  }finally{release?.();vi.restoreAllMocks();await f.cleanup()}
});
