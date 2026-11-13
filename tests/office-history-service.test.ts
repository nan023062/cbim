import {expect,it,vi} from 'vitest';
import {OfficeHistoryService} from '../src/logic/tasks/runtime/office-history-service';
import type {DispatchState,DispatchStore} from '../src/logic/dispatch/rules/dispatch-storage';
import type {DispatchRun} from '../src/logic/tasks/rules/dispatch-execution';
import type {RunSummary} from '../src/logic/execution/rules/types';
import {mainToolGraph,mainToolTask,mainToolTime,mainToolBinding} from './main-tool-output-fixture';

const identity={workspaceId:mainToolBinding.workspaceId,rootSessionId:mainToolBinding.rootSessionId},scopeId=mainToolBinding.scopeId;
function fixture(){
 const graph=mainToolGraph(),task=mainToolTask();graph.tasks=[task];
 const state:DispatchState={...identity,members:[],sessions:[],graphs:[graph],outbox:[],scopes:[{...identity,scopeId,status:'active',createdAt:mainToolTime,goal:{revision:1,input:{message:'本办公室原始要求',attachmentIds:[]}},runTracking:{version:1,mainRunIds:['main-run']}},{...identity,scopeId:'old',status:'closed',outcome:'cancelled',closedAt:mainToolTime,createdAt:mainToolTime},{...identity,scopeId:'foreign',rootSessionId:'other-office',status:'active',createdAt:mainToolTime}],runs:[{binding:{...identity,taskId:task.taskId,runId:'member-run'},topicContext:{inputRevision:2}} as DispatchRun]};
 const run=(taskId:string,runId:string,agentId:string,mode:'chat'|undefined):RunSummary=>({task:{taskId,workspaceId:identity.workspaceId,root:'C:/test',goal:'任务',moduleIds:[],acceptance:[],mode,agentId},runId,status:'completed',acceptance:'not_evaluated',unresolvedTools:[],events:[{version:1,seq:1,time:mainToolTime,...identity,taskId,runId,type:'run.started',data:{message:mode==='chat'?'用户原文':'PRIVATE_FROZEN_MEMBER_PROMPT'}},{version:1,seq:2,time:mainToolTime,workspaceId:identity.workspaceId,taskId,runId,type:'message',data:{role:'assistant',text:mode==='chat'?'主回答':'成员回答',internalReasoning:'PRIVATE_REASONING'}}]});
 const main=run(identity.rootSessionId,'main-run','cbim:main','chat'),member=run(task.taskId,'member-run',task.assignee.agentId,undefined);
 const read=vi.fn(async()=>structuredClone(state)),inspectMain=vi.fn(async()=>main),inspectMember=vi.fn(async()=>member);
 const service=new OfficeHistoryService(identity.workspaceId,{read} as unknown as DispatchStore,{inspectMain,inspectMember});
 const query=(input:unknown)=>service.read(identity,input,new AbortController().signal);
 return {state,main,member,service,query,inspectMain,inspectMember};
}
it('按当前主根列话题和原引用，列表不读取正文，不把其它办公室或旧任务混入',async()=>{
 const f=fixture(),topics=await f.query({action:'topics'});expect(topics.action).toBe('topics');if(topics.action!=='topics')throw Error('wrong');expect(topics.items.map(value=>value.scopeId)).toEqual([scopeId,'old']);
 const index=await f.query({action:'topic',scopeId});if(index.action!=='topic')throw Error('wrong');expect(index.items.map(value=>value.kind)).toEqual(['goal','main-run','assignment','member-run']);expect(index.items.at(-1)).toMatchObject({actorId:'cbim:executor',inputRevision:2});
 expect(f.inspectMain).not.toHaveBeenCalled();expect(f.inspectMember).not.toHaveBeenCalled();
 await expect(f.query({action:'topic',scopeId:'foreign'})).rejects.toMatchObject({code:'OFFICE_HISTORY_IDENTITY'});
 await expect(f.query({action:'content',scopeId:'old',refId:'main:main-run'})).rejects.toMatchObject({code:'OFFICE_HISTORY_REFERENCE'});
});
it('长公开正文按原版本可完整读取，成员冻结提示词、内部推理不暴露',async()=>{
 const f=fixture();f.main.events[1].data.text='完整公开正文'.repeat(5000);
 let text='',offset=0,version: string|undefined;do{const page=await f.query({action:'content',scopeId,refId:'main:main-run',offset,version,maxChars:16000});if(page.action!=='content')throw Error('wrong');text+=page.text;version=page.version;if(page.nextOffset===undefined)break;offset=page.nextOffset}while(true);
 expect(JSON.parse(text).events[1].data.text).toBe(f.main.events[1].data.text);expect(text).not.toContain('PRIVATE_REASONING');
 const member=await f.query({action:'content',scopeId,refId:'member:task:member-run'});if(member.action!=='content')throw Error('wrong');expect(member.text).toContain('成员回答');expect(member.text).not.toContain('PRIVATE_FROZEN_MEMBER_PROMPT');expect(f.inspectMember).toHaveBeenCalledTimes(1);
});
it('翻页必须核原版本；新输入或正文变更后不能混接旧页',async()=>{
 const f=fixture();const first=await f.query({action:'content',scopeId,refId:'goal',maxChars:10});if(first.action!=='content')throw Error('wrong');
 await expect(f.query({action:'content',scopeId,refId:'goal',offset:10})).rejects.toMatchObject({code:'OFFICE_HISTORY_CHANGED'});
 f.state.scopes![0].goal!.input.message='新输入';await expect(f.query({action:'content',scopeId,refId:'goal',offset:10,version:first.version})).rejects.toMatchObject({code:'OFFICE_HISTORY_CHANGED'});
 await expect(f.query({action:'topics',offset:999999,version:first.version})).rejects.toBeDefined();
});
it('拒绝跨根日志、取消与非法输入，不把读取异常包装成空历史',async()=>{
 const f=fixture();f.main.task.taskId='another-root';await expect(f.query({action:'content',scopeId,refId:'main:main-run'})).rejects.toMatchObject({code:'OFFICE_HISTORY_IDENTITY'});
 await expect(f.query({action:'content',scopeId,refId:'goal',rootSessionId:'another-root'})).rejects.toBeDefined();
 const stop=new AbortController();stop.abort();await expect(f.service.read(identity,{action:'topics'},stop.signal)).rejects.toBeDefined();
 f.inspectMember.mockRejectedValue(Error('日志损坏'));await expect(f.query({action:'content',scopeId,refId:'member:task:member-run'})).rejects.toThrow('日志损坏');
});
