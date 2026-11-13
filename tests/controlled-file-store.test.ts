import {expect,it,vi,afterEach} from 'vitest';
import fs from 'node:fs/promises';
import {hash} from '../src/core/platform/node/serialization';
import {controlledFileOperation,controlledFilePhaseCommand,controlledFilePhaseReceipt,controlledFileIntentHash,fileCompensationReceipt} from '../src/logic/file-operations/rules/controlled-file-rules';
import type {ControlledFileChange} from '../src/logic/file-operations/rules/controlled-file-event';
import {storeFixture,writeIntent,phases,mutation,compensationIntent} from './controlled-file-core-fixture';
const commit=(store:Awaited<ReturnType<typeof storeFixture>>['store'],change:ControlledFileChange)=>store.transact(controlledFilePhaseCommand(change),async()=>mutation(change));
afterEach(()=>vi.restoreAllMocks());

it('真实合法Store前缀→阶段独立追加；旧缺省/图周期游标/原命令重开不改变字节',async()=>{
  const f=await storeFixture();try{const state=await f.store.read(),prefix=await fs.readFile(f.file),view=await f.store.sessionRead({identity:state.graphs[0].identity,selectedScopeId:state.scopes![0].scopeId}),intent=writeIntent(state),events=phases(intent);expect(state).not.toHaveProperty('controlledFileChanges');
    const prepare=vi.fn(async()=>mutation(events[0]));const [a,b]=await Promise.all([f.store.transact(controlledFilePhaseCommand(events[0]),prepare),f.store.transact(controlledFilePhaseCommand(events[0]),prepare)]);expect(a).toEqual(b);expect(prepare).toHaveBeenCalledTimes(1);
    for(const event of events.slice(1))await commit(f.store,event);const after=await f.store.read();expect({...after,controlledFileChanges:undefined}).toEqual({...state,controlledFileChanges:undefined});expect(await f.store.sessionRead({identity:state.graphs[0].identity,selectedScopeId:state.scopes![0].scopeId})).toEqual(view);
    const bytes=await fs.readFile(f.file);expect(bytes.subarray(0,prefix.length)).toEqual(prefix);await f.reopen();expect(await f.store.read()).toEqual(after);expect(await fs.readFile(f.file)).toEqual(bytes);
    expect(await f.store.transact(controlledFilePhaseCommand(events[0]),async()=>{throw Error('must not prepare')})).toEqual(a);
    await expect(f.store.transact({...controlledFilePhaseCommand(events[0]),fingerprint:hash('other')},prepare)).rejects.toMatchObject({code:'COMMAND_ID_CONFLICT'});expect(await fs.readFile(f.file)).toEqual(bytes);
  }finally{await f.cleanup()}
});
it('混合写、篡改回执、跨运行来源和重复终态都拒绝且完整日志不变',async()=>{
  const f=await storeFixture();try{const intent=writeIntent(await f.store.read()),events=phases(intent),before=await fs.readFile(f.file);
    await expect(f.store.transact(controlledFilePhaseCommand(events[0]),async()=>({...mutation(events[0]),members:[]}))).rejects.toMatchObject({code:'CONTROLLED_FILE_AUDIT'});
    await expect(f.store.transact(controlledFilePhaseCommand(events[0]),async()=>({...mutation(events[0]),receipt:{state:'applied'}}))).rejects.toMatchObject({code:'CONTROLLED_FILE_AUDIT'});
    const bad=structuredClone(events[0]);if(bad.phase!=='prepared'||bad.intent.kind!=='member_write')throw Error('shape');bad.intent.origin.binding.runId='foreign';await expect(commit(f.store,bad)).rejects.toMatchObject({code:'CONTROLLED_FILE_AUDIT'});expect(await fs.readFile(f.file)).toEqual(before);
    for(const e of events)await commit(f.store,e);const bytes=await fs.readFile(f.file),unknown:ControlledFileChange={version:1,operationId:intent.operationId,recordedAt:intent.preparedAt,phase:'unknown',revision:3,previousRevision:2,intentHash:controlledFileIntentHash(intent),reasonCode:'LOST_REPLY'};
    await expect(commit(f.store,unknown)).rejects.toMatchObject({code:'COMMAND_ID_CONFLICT'});expect(await fs.readFile(f.file)).toEqual(bytes);
  }finally{await f.cleanup()}
});
it('补偿两命令并发仅一份prepared，原写保持applied；重开原补偿回执无新阶段',async()=>{
  const f=await storeFixture();try{const i=writeIntent(await f.store.read());for(const e of phases(i))await commit(f.store,e);await f.closeScope();const state=await f.store.read(),before=structuredClone(state.controlledFileChanges),a=compensationIntent(state),b=compensationIntent(state),ae=phases(a),be=phases(b);
    const results=await Promise.allSettled([commit(f.store,ae[0]),commit(f.store,be[0])]);expect(results.map(r=>r.status)).toEqual(['fulfilled','rejected']);
    for(const e of ae.slice(1))await commit(f.store,e);const next=await f.store.read(),receipt=fileCompensationReceipt(controlledFileOperation(next,a.operationId)!);expect(receipt.phase).toBe('applied');expect(next.controlledFileChanges!.slice(0,3)).toEqual(before);
    const bytes=await fs.readFile(f.file);await f.reopen();expect(fileCompensationReceipt(controlledFileOperation(await f.store.read(),a.operationId)!)).toEqual(receipt);expect((await f.store.commandReceipt(controlledFilePhaseCommand(ae[0]).commandId))?.receipt).toEqual(controlledFilePhaseReceipt(ae[0]));expect(await fs.readFile(f.file)).toEqual(bytes);
  }finally{await f.cleanup()}
});
it('prepared及executing重开仍未结算，不自动补terminal；原运行停止不抹掉迟到真实terminal',async()=>{
  for(const count of [1,2]){const f=await storeFixture();try{const i=writeIntent(await f.store.read()),events=phases(i);for(const e of events.slice(0,count))await commit(f.store,e);const bytes=await fs.readFile(f.file);await f.reopen();expect(controlledFileOperation(await f.store.read(),i.operationId)!.phase).toBe(count===1?'prepared':'executing');expect(await fs.readFile(f.file)).toEqual(bytes);
    await f.closeScope();if(count===1)await expect(commit(f.store,events[1])).rejects.toMatchObject({code:'CONTROLLED_FILE_AUDIT'});else{await commit(f.store,events[2]);expect(controlledFileOperation(await f.store.read(),i.operationId)!.phase).toBe('applied')}
  }finally{await f.cleanup()}}
});
it('即使重算journal校验和，坏阶段前缀仍拒绝恢复，原文件保留',async()=>{
  const f=await storeFixture();try{const i=writeIntent(await f.store.read());for(const e of phases(i))await commit(f.store,e);await f.store.close();const records=(await fs.readFile(f.file,'utf8')).trim().split('\n').map(line=>JSON.parse(line));
    const last=records.at(-1)!;last.body.mutation.controlledFileChanges[0].observedAfter.sha256=hash('fake');last.body.command=controlledFilePhaseCommand(last.body.mutation.controlledFileChanges[0]);last.body.mutation.receipt=controlledFilePhaseReceipt(last.body.mutation.controlledFileChanges[0]);last.checksum=hash(JSON.stringify(last.body));await fs.writeFile(f.file,records.map(r=>JSON.stringify(r)).join('\n')+'\n');const bytes=await fs.readFile(f.file);await f.reopen();await expect(f.store.read()).rejects.toMatchObject({code:'GRAPH_LOG_CORRUPT'});expect(await fs.readFile(f.file)).toEqual(bytes);
  }finally{await f.cleanup()}
});
it('sync失败不发布；完整已写帧只在重开校验后可见，失败实例不重发prepare',async()=>{
  const f=await storeFixture();try{const state=await f.store.read(),event=phases(writeIntent(state))[0],open=fs.open.bind(fs);let syncs=0;
    vi.spyOn(fs,'open').mockImplementation(async(...args:Parameters<typeof fs.open>)=>{const handle=await open(...args);if(args[0]===f.file&&args[1]==='a'){const original=handle.sync.bind(handle);handle.sync=async()=>{await original();syncs++;throw Error('lost fsync acknowledgement')}}return handle});
    const prepare=vi.fn(async()=>mutation(event));await expect(f.store.transact(controlledFilePhaseCommand(event),prepare)).rejects.toMatchObject({code:'GRAPH_STORAGE_FAILED'});expect(syncs).toBe(1);await expect(f.store.transact(controlledFilePhaseCommand(event),prepare)).rejects.toMatchObject({code:'GRAPH_STORAGE_FAILED'});expect(prepare).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();await f.reopen();expect((await f.store.read()).controlledFileChanges).toEqual([event]);expect((await f.store.commandReceipt(controlledFilePhaseCommand(event).commandId))?.receipt).toEqual(controlledFilePhaseReceipt(event));
  }finally{await f.cleanup()}
});
