import {expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {hash} from '../src/core/platform/node/serialization';
import {randomUUID} from 'node:crypto';
import {FileDispatchStore} from '../src/backend/main/dispatch-storage/dispatch-store';
import type {DispatchMutation} from '../src/logic/dispatch/rules/dispatch-storage';
import {memberEvent,ownershipEvent,bindingFor,ws,model,moduleId,command,rootMutation,taskMutation,initialScope,plannedScope,claimMutation,cancelClaimMutation} from './owner-execution-core-fixture';

async function fixture(){const directory=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-owner-protocol-'));let store=new FileDispatchStore(directory,ws);return {directory,file:path.join(directory,'dispatch.jsonl'),get store(){return store},async reopen(){await store.close();store=new FileDispatchStore(directory,ws);return store},async cleanup(){await store.close();if(!path.resolve(directory).startsWith(path.join(os.tmpdir(),'cbim-owner-protocol-')))throw Error('Invalid fixture directory');await fs.rm(directory,{recursive:true,force:true})}}}
async function registry(store:FileDispatchStore){const member=memberEvent(await store.read());await store.transact(member.command,async()=>member.mutation);const owner=ownershipEvent(await store.read());await store.transact(owner.command,async()=>owner.mutation);return {member,owner,binding:bindingFor(await store.read())}}
async function plan(store:FileDispatchStore,binding:ReturnType<typeof bindingFor>){await store.transact(command('root'),async()=>rootMutation());await store.transact(command('scope'),async()=>({scopes:[initialScope()],receipt:'scope'}));await store.transact(command('plan'),async()=>({scopes:[plannedScope(binding)],receipt:'plan'}));}
async function appendLegacy(file:string,mutation:DispatchMutation,commandId:string){let records:any[]=[];try{records=(await fs.readFile(file,'utf8')).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line))}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}const body={version:1,workspaceId:ws,transactionSeq:records.length+1,previousHash:records.at(-1)?.checksum??'',command:command(commandId),mutation};await fs.appendFile(file,JSON.stringify({body,checksum:hash(JSON.stringify(body))})+'\n');}

it('真实登记来源→计划→派发→领取固定同一岗位模型，重复与重开不重做',async()=>{
  const f=await fixture();try{const r=await registry(f.store);await plan(f.store,r.binding);const before=await f.store.read(),prepare=vi.fn(async()=>taskMutation(r.binding));
    expect(await f.store.transact(command('dispatch'),prepare)).toBe('dispatch');expect(await f.store.transact(command('dispatch'),prepare)).toBe('dispatch');expect(prepare).toHaveBeenCalledTimes(1);
    await f.store.transact(command('claim'),async state=>claimMutation(state));const claimed=await f.store.read();expect(claimed.graphs[0].tasks[0].ownerBinding).toEqual(r.binding);expect(claimed.runs![0].prepared.memberContext!.binding).toEqual(r.binding);expect(claimed.runs![0].model).toEqual(model);expect(claimed.workspaceMembers).toEqual(before.workspaceMembers);expect(claimed.moduleOwnerships).toEqual(before.moduleOwnerships);
    const bytes=await fs.readFile(f.file),records=bytes.toString().trim().split('\n').map(line=>JSON.parse(line));expect(records.every(record=>record.body.executionProtocol==='module_owner_v1')).toBe(true);
    await f.reopen();expect(await f.store.read()).toEqual(claimed);expect((await f.store.commandReceipt('dispatch'))?.receipt).toBe('dispatch');expect(await fs.readFile(f.file)).toEqual(bytes);
    await expect(f.store.transact({...command('dispatch'),fingerprint:'changed'},prepare)).rejects.toMatchObject({code:'COMMAND_ID_CONFLICT'});expect(prepare).toHaveBeenCalledTimes(1);
  }finally{await f.cleanup()}
});

it('缺负责人新派发、伪计划/伪绑定/混合登记均零日志变化',async()=>{
  const f=await fixture();try{const r=await registry(f.store);await plan(f.store,r.binding);const before=await f.store.read(),bytes=await fs.readFile(f.file);
    await expect(f.store.transact(command('dispatch'),async()=>taskMutation())).rejects.toMatchObject({code:'OWNER_BINDING_REQUIRED'});
    const wrong=structuredClone(taskMutation(r.binding));const node=wrong.batch!.changes.find(change=>change.type==='task.upserted')!;if(node.type==='task.upserted')node.task.ownerBinding!.memberHash='a'.repeat(64);await expect(f.store.transact(command('dispatch'),async()=>wrong)).rejects.toThrow(/审计/);
    const edit=memberEvent(before,{kind:'update',memberId:r.binding.memberId,expectedRevision:1,patch:{name:'Changed'},reason:'rename'});await expect(f.store.transact(command('dispatch'),async()=>({...taskMutation(r.binding),workspaceMemberChanges:edit.mutation.workspaceMemberChanges}))).rejects.toBeDefined();
    await expect(f.store.transact(command('dispatch'),async()=>({...taskMutation(r.binding),executionProtocol:'legacy'}))).rejects.toThrow(/协议/);
    expect(await f.store.read()).toEqual(before);expect(await fs.readFile(f.file)).toEqual(bytes);
    await f.store.transact(command('dispatch'),async()=>taskMutation(r.binding));
    const state=await f.store.read(),current=state.graphs[0].tasks[0];const bad={...current,revision:current.revision+1,ownerBinding:undefined};
    await expect(f.store.transact(command('rewrite'),async()=>({batch:{...taskMutation(r.binding).batch!,commandId:'rewrite',eventId:'rewrite',seq:3,changes:[{type:'task.upserted',task:bad}]},receipt:null}))).rejects.toThrow(/负责人/);
  }finally{await f.cleanup()}
});

it('岗位变化先提交时旧领取拒绝，先领取后变化仍按原冻结事实结算',async()=>{
  for(const claimFirst of [false,true]){const f=await fixture();try{const r=await registry(f.store);await plan(f.store,r.binding);await f.store.transact(command('dispatch'),async()=>taskMutation(r.binding));
    if(claimFirst)await f.store.transact(command('claim'),async state=>claimMutation(state));
    const state=await f.store.read(),pause=memberEvent(state,{kind:'state',memberId:r.binding.memberId,expectedRevision:1,nextState:'suspended',reason:'Pause job'});await f.store.transact(pause.command,async()=>pause.mutation);
    if(claimFirst){await f.store.transact(command('settle'),async state=>cancelClaimMutation(state));expect((await f.store.read()).runs![0].prepared.memberContext!.binding).toEqual(r.binding);expect((await f.store.read()).runs![0].status).toBe('cancelled');await f.reopen();expect((await f.store.read()).runs![0].status).toBe('cancelled')}
    else{const bytes=await fs.readFile(f.file);await expect(f.store.transact(command('claim'),async state=>claimMutation(state))).rejects.toMatchObject({code:'OWNER_MEMBER_UNAVAILABLE'});expect((await f.store.read()).runs).toEqual([]);expect((await f.store.read()).outbox[0].delivery).toBe('pending');expect(await fs.readFile(f.file)).toEqual(bytes)}
  }finally{await f.cleanup()}}
});

it('旧无标记日志原字节可读及原回执可查，新领取必须明确重派',async()=>{
  const f=await fixture();try{await appendLegacy(f.file,rootMutation(),'root');await appendLegacy(f.file,taskMutation(undefined,false),'dispatch');const bytes=await fs.readFile(f.file),state=await f.store.read();expect(state.graphs[0].tasks[0]).not.toHaveProperty('ownerBinding');expect((await f.store.commandReceipt('dispatch'))?.receipt).toBe('dispatch');
    await expect(f.store.transact(command('claim'),async state=>claimMutation(state))).rejects.toMatchObject({code:'OWNER_BINDING_REQUIRED'});expect(await fs.readFile(f.file)).toEqual(bytes);expect(await f.store.read()).toEqual(state);
    expect(await f.store.transact(command('dispatch'),async()=>{throw Error('old receipt must not prepare')})).toBe('dispatch');expect(await fs.readFile(f.file)).toEqual(bytes);
  }finally{await f.cleanup()}
});

it('旧已经领取的运行可用新协议结算，不补任务岗位、不重写旧前缀',async()=>{
  const f=await fixture();try{await appendLegacy(f.file,rootMutation(),'root');await appendLegacy(f.file,taskMutation(undefined,false),'dispatch');const state=await f.store.read();await f.store.close();await appendLegacy(f.file,claimMutation(state),'claim');await f.reopen();const prefix=await fs.readFile(f.file);expect((await f.store.read()).runs![0].status).toBe('starting');
    await f.store.transact(command('settle'),async state=>cancelClaimMutation(state));const settled=await f.store.read();expect(settled.runs![0].status).toBe('cancelled');expect(settled.runs![0].prepared).not.toHaveProperty('memberContext');expect(settled.graphs[0].tasks[0]).not.toHaveProperty('ownerBinding');expect((await fs.readFile(f.file)).subarray(0,prefix.length)).toEqual(prefix);
    await f.reopen();expect(await f.store.read()).toEqual(settled);
  }finally{await f.cleanup()}
});

it('新协议开始后旧格式后缀和未知协议即使重算哈希仍拒绝',async()=>{
  for(const protocol of [undefined,'legacy','module_owner_v2']){const f=await fixture();try{await f.store.transact(command('root'),async()=>rootMutation());await f.store.close();const records=(await fs.readFile(f.file,'utf8')).trim().split('\n').map(line=>JSON.parse(line));const body={version:1,...(protocol===undefined?{}:{executionProtocol:protocol}),workspaceId:ws,transactionSeq:2,previousHash:records[0].checksum,command:command('next'),mutation:{receipt:'noop'}};await fs.appendFile(f.file,JSON.stringify({body,checksum:hash(JSON.stringify(body))})+'\n');await f.reopen();await expect(f.store.read()).rejects.toMatchObject({code:'GRAPH_LOG_CORRUPT'});}finally{await f.cleanup()}}
});

it('任务绑定不能借相同Agent另一岗位或owner A→B→A的旧版本重新领取',async()=>{
  const f=await fixture();try{const r=await registry(f.store);await plan(f.store,r.binding);await f.store.transact(command('dispatch'),async()=>taskMutation(r.binding));const other=memberEvent(await f.store.read());await f.store.transact(other.command,async()=>other.mutation);
    const b=ownershipEvent(await f.store.read(),other.event.next.memberId,moduleId);await f.store.transact(b.command,async()=>b.mutation);const a=ownershipEvent(await f.store.read(),r.binding.memberId,moduleId);await f.store.transact(a.command,async()=>a.mutation);const bytes=await fs.readFile(f.file);
    await expect(f.store.transact(command('claim'),async state=>claimMutation(state))).rejects.toMatchObject({code:'OWNER_SELECTION_STALE'});expect(await fs.readFile(f.file)).toEqual(bytes);expect((await f.store.read()).graphs[0].tasks[0].ownerBinding).toEqual(r.binding);
  }finally{await f.cleanup()}
});

it('同Agent两岗位派发保留不同执行实例与通道，不能复用第一个岗位实例',async()=>{
  const f=await fixture();try{const r=await registry(f.store),second=memberEvent(await f.store.read(),undefined,{...model,id:randomUUID(),model:'second'});await f.store.transact(second.command,async()=>second.mutation);const owned=ownershipEvent(await f.store.read(),second.event.next.memberId,moduleId+'/other');await f.store.transact(owned.command,async()=>owned.mutation);const binding=bindingFor(await f.store.read(),[moduleId+'/other']);
    await f.store.transact(command('root'),async()=>rootMutation());await f.store.transact(command('scope'),async()=>({scopes:[initialScope()],receipt:'scope'}));const scope=plannedScope(r.binding),assignment=plannedScope(binding).goal!.plan!.assignments[0];assignment.moduleIds=[moduleId+'/other'];assignment.moduleNames=['Other'];scope.goal!.plan!.assignments.push(assignment);await f.store.transact(command('plan'),async()=>({scopes:[scope],receipt:'plan'}));await f.store.transact(command('dispatch'),async()=>taskMutation(r.binding));
    const mutation=structuredClone(taskMutation(binding));mutation.batch!.commandId='dispatch2';mutation.batch!.eventId='dispatch2';mutation.batch!.seq=3;mutation.members![0].executionTaskId='task2';mutation.members![0].agentInstanceId='instance2';mutation.members![0].agentSessionIds=['channel2'];mutation.sessions![0].agentInstanceId='instance2';mutation.sessions![0].agentSessionId='channel2';const node=mutation.batch!.changes.find(change=>change.type==='task.upserted')!;if(node.type!=='task.upserted')throw Error('task');node.task.taskId='task2';node.task.nodeId='task:task2';node.task.assignee.agentInstanceId='instance2';node.task.assignee.agentSessionId='channel2';node.task.modules[0].moduleId=moduleId+'/other';for(const change of mutation.batch!.changes){if(change.type==='edge.upserted'){change.edge.edgeId='edge2';change.edge.toNodeId='task:task2'}if(change.type==='agent.upserted')change.agent.agentInstanceId='instance2'}const message=mutation.messages![0];message.taskId='task2';message.commandId='dispatch2';message.messageId='assignment2';message.to=node.task.assignee;
    const aliased=structuredClone(mutation);aliased.members![0].agentInstanceId='member-instance';aliased.members![0].agentSessionIds=['member-channel'];aliased.sessions![0].agentInstanceId='member-instance';aliased.sessions![0].agentSessionId='member-channel';await expect(f.store.transact(command('dispatch2'),async()=>aliased)).rejects.toBeDefined();
    await f.store.transact(command('dispatch2'),async()=>mutation);const state=await f.store.read();expect(new Set(state.graphs[0].tasks.map(task=>task.assignee.agentInstanceId)).size).toBe(2);expect(new Set(state.graphs[0].tasks.map(task=>task.assignee.agentSessionId)).size).toBe(2);expect(state.graphs[0].tasks.map(task=>task.ownerBinding!.memberId)).toEqual([r.binding.memberId,binding.memberId]);expect(state.graphs[0].tasks[1].ownerBinding!.model.modelId).toBe('second');
  }finally{await f.cleanup()}
});
