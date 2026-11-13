import {expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './helpers';
import {FileDispatchStore} from '../src/backend/main/dispatch-storage/dispatch-store';
import {WorkspaceDispatchService} from '../src/logic/dispatch/runtime/dispatch-service';
import {dispatchApplication} from '../src/backend/main/ipc/dispatch';
import type {ApplicationServices} from '../src/backend/main/ipc/services';
import {applyScopeBatch,validateScopeSnapshot,type ScopeSnapshot,type ScopeCursor,type DispatchSessionRead} from '../src/bridge/contracts/dispatch';
import {readScopeDelta,summarizeScope,emptyScopeSnapshot,scopeViewHistoryLimit} from '../src/logic/tasks/rules/scope-view';
import type {DispatchScope} from '../src/logic/tasks/rules/dispatch-scope';
import {dispatchScopeGoalSchema,type GoalPlanInput} from '../src/logic/tasks/rules/scope-goal';

async function setup(){
  const f=await fixture(),entry=await f.app.dispatch('add',{path:f.a}),workspace=f.app.workspace(entry.id);
  const directory=path.join(f.user,'session-view'),store=new FileDispatchStore(directory,entry.id),service=new WorkspaceDispatchService(workspace,store);
  const identity={workspaceId:entry.id,rootSessionId:'root-one'};
  return {...f,entry,workspace,directory,store,service,identity,cleanup:async()=>{await store.close();await f.cleanup()}};
}
function full(value:DispatchSessionRead){expect(value.scopes.mode).toBe('reset');expect(value.detail.mode).toBe('updated');if(value.scopes.mode!=='reset'||value.detail.mode!=='updated')throw Error('missing full response');return {scopes:value.scopes.snapshot,stamp:value.detail.stamp,scope:value.detail.scope}}
const plan:GoalPlanInput={expectedRevision:1,objective:'维护团队知识',constraints:['不改业务文件'],criteria:[{id:'review',text:'治理方案需人工判断',kind:'human'}],assignments:[{agentId:'cbim:main',moduleIds:[],criterionIds:['review'],reason:'主角色负责治理'}],reason:'先规划后执行'};

it('主会话联合读取不创建图或周期；IPC严格传递身份且重复读取不写日志或回读知识',async()=>{
  const f=await setup();try{
    const app={memberDispatch:vi.fn(()=>f.service)} as unknown as ApplicationServices;
    await expect(dispatchApplication(app,'dispatch.sessionRead',{identity:f.identity})).rejects.toMatchObject({code:'GRAPH_NOT_FOUND'});
    expect((await f.store.read()).scopes).toEqual([]);
    await f.service.openGraph({...f.identity,commandId:'open-empty'});
    const empty=await f.service.sessionRead({identity:f.identity});expect(empty.detail).toEqual({mode:'empty'});expect(empty.scopes.cursor.seq).toBe(0);
    const message='原始输入\n'+'x'.repeat(100_000);
    await f.service.openScope(f.identity,'scope-one',{message});
    const first=await dispatchApplication(app,'dispatch.sessionRead',{identity:f.identity}) as DispatchSessionRead;
    const {scopes,stamp,scope}=full(first);expect(scope.goal!.input.message).toBe(message);expect(scopes.scopes[0].inputPreview!.length).toBeLessThanOrEqual(240);
    expect(JSON.stringify(scopes).length).toBeLessThan(1500);
    const file=path.join(f.directory,'dispatch.jsonl'),before=await fs.readFile(file,'utf8');
    const snapshot=vi.spyOn(f.workspace,'snapshot');
    const args={identity:f.identity,graphCursor:first.graph.cursor,scopeCursor:first.scopes.cursor,detailStamp:stamp};
    const unchanged=await dispatchApplication(app,'dispatch.sessionRead',args) as DispatchSessionRead;
    expect(unchanged).toEqual({graph:{mode:'noop',cursor:first.graph.cursor},scopes:{mode:'noop',cursor:first.scopes.cursor},detail:{mode:'noop',stamp}});
    expect(snapshot).not.toHaveBeenCalled();snapshot.mockRestore();expect(await fs.readFile(file,'utf8')).toBe(before);
    expect(app.memberDispatch).toHaveBeenLastCalledWith(f.identity.workspaceId);
    scope.goal!.input.message='UI修改';expect(full(await f.service.sessionRead({identity:f.identity})).scope.goal!.input.message).toBe(message);
    expect(()=>f.service.sessionRead({...args,unknown:true})).toThrowError(expect.objectContaining({code:'GRAPH_INPUT_INVALID'}));
  }finally{await f.cleanup()}
});

it('plan、block和close独立增量；block/close不加goal版本也更新详情stamp，且图游标完全不变',async()=>{
  const f=await setup();try{
    await f.service.openScope(f.identity,'scope-one',{message:'维护知识'});
    const initial=await f.service.sessionRead({identity:f.identity}),first=full(initial);
    await f.service.goals.plan(f.identity,'scope-one','main-run','plan-one',plan);
    const planned=await f.service.sessionRead({identity:f.identity,graphCursor:initial.graph.cursor,scopeCursor:initial.scopes.cursor,detailStamp:first.stamp});
    expect(planned.graph.mode).toBe('noop');expect(planned.scopes.mode).toBe('delta');expect(planned.detail.mode).toBe('updated');
    if(planned.scopes.mode!=='delta'||planned.detail.mode!=='updated')throw Error('missing plan');
    expect(planned.scopes.batches[0].scopes[0]).toMatchObject({hasPlan:true,goalRevision:2,objective:plan.objective});
    const blocked=await f.service.goals.block(f.identity,'scope-one','等待维护者人工确认');
    const blockedRead=await f.service.sessionRead({identity:f.identity,graphCursor:initial.graph.cursor,scopeCursor:planned.scopes.cursor,detailStamp:planned.detail.stamp});
    expect(blockedRead.graph.mode).toBe('noop');expect(blocked.goal!.revision).toBe(2);
    expect(blockedRead.detail).toMatchObject({mode:'updated',scope:{status:'active',goal:{revision:2,blocked:{reason:'等待维护者人工确认'}}}});
    if(blockedRead.detail.mode!=='updated')throw Error('missing blocked');
    expect(blockedRead.detail.stamp.seq).toBe(planned.detail.stamp.seq+1);
    await f.service.closeScope(f.identity,'scope-one','failed');
    const closed=await f.service.sessionRead({identity:f.identity,graphCursor:initial.graph.cursor,scopeCursor:blockedRead.scopes.cursor,detailStamp:blockedRead.detail.stamp});
    expect(closed.graph.mode).toBe('noop');expect(closed.detail).toMatchObject({mode:'updated',scope:{status:'closed',outcome:'failed',goal:{revision:2}}});
    expect(closed.scopes.cursor.seq).toBe(4);
    const replay=new FileDispatchStore(f.directory,f.entry.id);try{expect(await replay.sessionRead({identity:f.identity})).toEqual(await f.service.sessionRead({identity:f.identity}))}finally{await replay.close()}
  }finally{await f.cleanup()}
});

it('跨会话变化不推进本会话周期游标，详情选择拒绝其他会话，幂等重发不产生增量',async()=>{
  const f=await setup();try{
    await f.service.openScope(f.identity,'scope-one',{message:'当前会话'});
    const first=await f.service.sessionRead({identity:f.identity}),selected=full(first),other={...f.identity,rootSessionId:'root-two'};
    await f.service.openScope(other,'scope-other',{message:'另一会话私有输入'});
    await f.service.openScope(f.identity,'scope-one',{message:'当前会话'});
    const args={identity:f.identity,graphCursor:first.graph.cursor,scopeCursor:first.scopes.cursor,detailStamp:selected.stamp};
    expect(await f.service.sessionRead(args)).toMatchObject({graph:{mode:'noop'},scopes:{mode:'noop'},detail:{mode:'noop'}});
    await expect(f.service.sessionRead({...args,selectedScopeId:'scope-other'})).rejects.toMatchObject({code:'DISPATCH_SCOPE_IDENTITY'});
    await expect(f.service.sessionRead({...args,scopeCursor:{...first.scopes.cursor,rootSessionId:'root-two'}})).rejects.toMatchObject({code:'GRAPH_IDENTITY_MISMATCH'});
    await expect(f.service.sessionRead({...args,graphCursor:{...first.graph.cursor,rootSessionId:'root-two'}})).rejects.toMatchObject({code:'GRAPH_IDENTITY_MISMATCH'});
    expect(()=>f.service.sessionRead({...args,identity:{...f.identity,workspaceId:'elsewhere'}})).toThrowError(expect.objectContaining({code:'GRAPH_IDENTITY_MISMATCH'}));
    const otherStamp=full(await f.service.sessionRead({identity:other})).stamp;
    expect(await f.service.sessionRead({...args,detailStamp:otherStamp})).toMatchObject({detail:{mode:'updated',scope:{scopeId:'scope-one'}}});
    await f.service.closeScope(f.identity,'scope-one','completed');await f.service.openScope(f.identity,'scope-new',{message:'新任务'});
    expect(full(await f.service.sessionRead({identity:f.identity})).scope.scopeId).toBe('scope-new');
    expect(full(await f.service.sessionRead({identity:f.identity,selectedScopeId:'scope-one'})).scope.status).toBe('closed');
    const idem=await f.service.sessionRead({identity:f.identity});await f.service.closeScope(f.identity,'scope-one','completed');
    expect((await f.service.sessionRead({identity:f.identity,scopeCursor:idem.scopes.cursor})).scopes.mode).toBe('noop');
  }finally{await f.cleanup()}
});

it('缺省与未来/换流游标reset，分页连续且旧无goal周期不被补造',async()=>{
  const f=await setup();try{
    await f.service.openGraph({...f.identity,commandId:'empty'});
    const empty=await f.service.sessionRead({identity:f.identity});
    await f.service.openScope(f.identity,'legacy');await f.service.closeScope(f.identity,'legacy','completed');
    await f.service.openScope(f.identity,'modern',{message:'下一轮'});
    const first=await f.service.sessionRead({identity:f.identity,scopeCursor:empty.scopes.cursor,limit:1});
    expect(first.scopes).toMatchObject({mode:'delta',hasMore:true,cursor:{seq:1}});
    if(first.scopes.mode!=='delta')throw Error('missing page');
    expect(first.scopes.batches[0].scopes[0]).toMatchObject({scopeId:'legacy',hasGoal:false,hasPlan:false});
    expect(first.scopes.batches[0].scopes[0]).not.toHaveProperty('goalRevision');
    const second=await f.service.sessionRead({identity:f.identity,scopeCursor:first.scopes.cursor,limit:1});expect(second.scopes).toMatchObject({mode:'delta',hasMore:true,cursor:{seq:2}});
    const last=await f.service.sessionRead({identity:f.identity,scopeCursor:second.scopes.cursor,limit:1});expect(last.scopes).toMatchObject({mode:'delta',hasMore:false,cursor:{seq:3}});
    const historical=full(await f.service.sessionRead({identity:f.identity,selectedScopeId:'legacy'}));expect(historical.scope).not.toHaveProperty('goal');
    expect(await f.service.sessionRead({identity:f.identity,scopeCursor:{...last.scopes.cursor,seq:999}})).toMatchObject({scopes:{mode:'reset',reason:'cursor_ahead'}});
    expect(await f.service.sessionRead({identity:f.identity,scopeCursor:{...last.scopes.cursor,streamId:'scopes:replaced'}})).toMatchObject({scopes:{mode:'reset',reason:'stream_changed'}});
    expect(()=>f.service.sessionRead({identity:f.identity,scopeCursor:last.graph.cursor})).toThrowError(expect.objectContaining({code:'GRAPH_INPUT_INVALID'}));
    expect(()=>f.service.sessionRead({identity:f.identity,limit:0})).toThrowError(expect.objectContaining({code:'GRAPH_INPUT_INVALID'}));
  }finally{await f.cleanup()}
});

it('图和周期读取等待同一提交屏障，不暴露关闭事务的半次状态',async()=>{
  const f=await setup();try{
    await f.service.openScope(f.identity,'scope-one',{message:'关闭同屏'});
    const first=await f.service.sessionRead({identity:f.identity});
    let release!:()=>void,entered!:()=>void;
    const gate=new Promise<void>(resolve=>{release=resolve}),ready=new Promise<void>(resolve=>{entered=resolve});
    const commit=f.store.transact({commandId:'atomic-close',fingerprint:'atomic-close'},async state=>{
      entered();await gate;const graph=state.graphs[0],scope=state.scopes![0];
      return {receipt:true,scopes:[{...scope,status:'closed' as const,outcome:'cancelled' as const,closedAt:new Date().toISOString()}],batch:{version:1 as const,identity:f.identity,streamId:graph.cursor.streamId,seq:graph.cursor.seq+1,eventId:'close-event',commandId:'atomic-close',cause:'agent.state_changed' as const,committedAt:new Date().toISOString(),changes:[{type:'root.upserted' as const,root:{...graph.root,revision:graph.root.revision+1}}]}};
    });
    await ready;let returned=false;
    const read=f.service.sessionRead({identity:f.identity,graphCursor:first.graph.cursor,scopeCursor:first.scopes.cursor}).then(value=>{returned=true;return value});
    await new Promise(resolve=>setTimeout(resolve,10));expect(returned).toBe(false);release();await commit;
    const result=await read;expect(result.graph.mode).toBe('delta');expect(result.scopes.mode).toBe('delta');expect(result.detail).toMatchObject({mode:'updated',scope:{status:'closed',outcome:'cancelled'}});
    expect(result.graph.cursor.seq).toBe(first.graph.cursor.seq+1);expect(result.scopes.cursor.seq).toBe(first.scopes.cursor.seq+1);
  }finally{await f.cleanup()}
});

it('纯周期投影保持未变摘要引用，校验断序/串会话；complete申请不投影为生命周期完成',()=>{
  const identity={workspaceId:'workspace',rootSessionId:'root'},base=emptyScopeSnapshot(identity,'graph-stream');
  const scope:DispatchScope={...identity,scopeId:'one',status:'active',createdAt:'2026-11-07T00:00:00.000Z'};
  const event={identity,streamId:base.cursor.streamId,seq:1,scopes:[summarizeScope(scope,base.cursor.streamId,1)]};
  const one=applyScopeBatch(base,event);validateScopeSnapshot(one);expect(applyScopeBatch(one,event)).toBe(one);
  const two=applyScopeBatch(one,{...event,seq:2,scopes:[summarizeScope({...scope,scopeId:'two'},base.cursor.streamId,2)]});expect(two.scopes[0]).toBe(one.scopes[0]);
  expect(()=>applyScopeBatch(two,{...event,seq:4,scopes:[{...event.scopes[0],stamp:{...event.scopes[0].stamp,seq:4}}]})).toThrow(/断档/);
  expect(()=>applyScopeBatch(one,{...event,identity:{...identity,rootSessionId:'other'}})).toThrow();
  const corrupt:ScopeSnapshot={...one,scopes:[{...one.scopes[0],stamp:{...one.scopes[0].stamp,seq:9}}]};expect(()=>validateScopeSnapshot(corrupt)).toThrow();
  const compacted=readScopeDelta(two,[],{...base.cursor,seq:0});expect(compacted).toMatchObject({mode:'reset',reason:'history_compacted'});
  const decisionStamp={runId:'main-run',recordedAt:scope.createdAt,knowledgeRevision:'knowledge-1',graphCursor:{streamId:'graph-stream',seq:1}};
  const goal=dispatchScopeGoalSchema.parse({revision:3,input:{message:'知识治理目标',attachmentIds:[]},
    plan:{...decisionStamp,revision:2,objective:'保存知识',constraints:[],criteria:[{id:'saved',text:'知识有提交证据',kind:'evidence'}],assignments:[{agentId:'cbim:main',teamId:'.cbim/team',agentName:'主 Agent',moduleIds:[],moduleNames:[],criterionIds:['saved'],reason:'维护知识'}],reason:'按用户目标规划'},
    review:{...decisionStamp,revision:3,planRevision:2,decision:'complete',checks:[{criterionId:'saved',outcome:'satisfied',reason:'已引用候选证据',evidence:[{kind:'main-knowledge',toolCallIds:['commit-1']}]}],superseded:[],gaps:[],reason:'申请结算复核',observedSeq:2,lastEffectSeq:2}});
  const pending=summarizeScope({...scope,goal},base.cursor.streamId,3);
  expect(pending).toMatchObject({status:'active',reviewDecision:'complete'});expect(pending).not.toHaveProperty('outcome');
  expect(readScopeDelta(two,[],{...two.cursor} as ScopeCursor)).toMatchObject({mode:'noop'});
});

it('周期摘要仅保留有界重放证明；超窗重复拒绝，旧游标通过reset恢复',()=>{
  const identity={workspaceId:'workspace',rootSessionId:'root'},base=emptyScopeSnapshot(identity,'graph-stream');
  const scope:DispatchScope={...identity,scopeId:'one',status:'active',createdAt:'2026-11-07T00:00:00.000Z'};
  const batches=Array.from({length:scopeViewHistoryLimit+2},(_,index)=>({identity,streamId:base.cursor.streamId,seq:index+1,scopes:[summarizeScope(scope,base.cursor.streamId,index+1)]}));
  const snapshot=batches.reduce(applyScopeBatch,base);
  expect(applyScopeBatch(snapshot,batches.at(-1)!)).toBe(snapshot);
  expect(()=>applyScopeBatch(snapshot,batches[0])).toThrowError(expect.objectContaining({code:'SCOPE_EVENT_CONFLICT'}));
  const retained=batches.slice(-scopeViewHistoryLimit);
  expect(readScopeDelta(snapshot,retained,base.cursor)).toMatchObject({mode:'reset',reason:'history_compacted'});
  const cursor={...base.cursor,seq:retained[0].seq-1};
  expect(readScopeDelta(snapshot,retained,cursor,1)).toMatchObject({mode:'delta',cursor:{seq:retained[0].seq},hasMore:true});
});
