import {expect,it,vi} from 'vitest';
import {AgentBusinessRuns} from '../../../../../src/logic/execution/storage/business-runs';
import {baseState} from '../../file-operations/rules/support/controlled-file-core-fixture';
import type {AgentBusinessRun} from '../../../../../src/logic/execution/rules/business-run';
import type {DispatchStore} from '../../../../../src/logic/dispatch/rules/dispatch-storage';
import type {RunSummary} from '../../../../../src/logic/execution/rules/types';
function fixture(){
 const state=baseState(),old=state.runs![0],binding={...old.binding,taskId:'child',runId:'child-run'};
 const parent={version:1 as const,workspaceId:state.workspaceId,callerTaskId:binding.rootSessionId,callerRunId:'root-run',toolCallId:'call',taskId:binding.taskId,runId:binding.runId};
 const value:Omit<AgentBusinessRun,'lineage'>={protocol:'agent-tools-v1',binding,scopeId:state.scopes![0].scopeId,parent,prepared:old.prepared,permission:'execute',status:'active',createdAt:old.createdAt};
 const events=[{type:'run.started',data:{executionModel:'agent-tools-v1'}},{type:'tool.allowed',data:{id:'call',name:'cbim_agent_call'}},{type:'tool.updated',data:{id:'call',agentCall:parent,limits:{depth:1}}}];
 const summary={task:{workspaceId:state.workspaceId,taskId:binding.rootSessionId},runId:'root-run',events,logIntegrity:{partialTail:false}} as unknown as RunSummary;
 const transact=vi.fn(async(_command,change)=>{const mutation=await change();state.agentBusinessRuns=mutation.agentBusinessRuns;return mutation.receipt});
 const store={Read:async()=>state,Transact: transact} as unknown as DispatchStore;
 const inspect=vi.fn(async()=>summary),assertCurrent=vi.fn(),service=new AgentBusinessRuns(store,assertCurrent,inspect);
 return {state,value,summary,events,transact,inspect,assertCurrent,service};
}
it('registers from the single initial binding even after repeated wait/resume updates and closes idempotently',async()=>{
 const f=fixture();f.events.push({type:'tool.updated',data:{id:'call',agentCall:f.value.parent}} as any);
 await f.service.Start(f.value);expect(f.state.agentBusinessRuns?.[0].lineage).toEqual([f.value.parent]);expect(f.transact).toHaveBeenCalledTimes(1);
 await f.service.Close(f.value);expect(f.state.agentBusinessRuns?.[0].status).toBe('closed');await f.service.Close(f.value);expect(f.transact).toHaveBeenCalledTimes(2);
});
it.each(['missing-allow','duplicate-binding','foreign-reference','settled','partial-tail'] as const)('rejects unverifiable ancestry before recording (%s)',async kind=>{
 const f=fixture();if(kind==='missing-allow')f.events.splice(1,1);
 if(kind==='duplicate-binding')f.events.push(f.events[2]);
 if(kind==='foreign-reference')f.events.push({type:'tool.updated',data:{id:'call',agentCall:{...f.value.parent,runId:'foreign'}}} as any);
 if(kind==='settled')f.events.push({type:'run.settled',data:{}} as any);
 if(kind==='partial-tail')f.summary.logIntegrity!.partialTail=true;
 await expect(f.service.Start(f.value)).rejects.toMatchObject({code:'AGENT_RUN_IDENTITY'});expect(f.transact).not.toHaveBeenCalled();
});
it('traces an ordinary intermediate Agent to the same root without inventing a dispatch run',async()=>{
 const f=fixture(),rootLink={...f.value.parent,taskId:'middle',runId:'middle-run',toolCallId:'call-middle'};
 f.value.parent={...f.value.parent,callerTaskId:'middle',callerRunId:'middle-run'};
 const middle={...f.summary,task:{...f.summary.task,taskId:'middle'},runId:'middle-run',events:[{type:'run.started',data:{executionModel:'agent-tools-v1',agentCall:rootLink}},{type:'tool.allowed',data:{id:'call',name:'cbim_agent_call'}},{type:'tool.updated',data:{id:'call',agentCall:f.value.parent,limits:{depth:2}}}]} as unknown as RunSummary;
 f.summary.events=[{type:'run.started',data:{executionModel:'agent-tools-v1'}},{type:'tool.allowed',data:{id:'call-middle',name:'cbim_agent_call'}},{type:'tool.updated',data:{id:'call-middle',agentCall:rootLink,limits:{depth:1}}}] as any;
 f.inspect.mockImplementation(async(taskId?:string)=>taskId==='middle'?middle:f.summary);
 await f.service.Start(f.value);expect(f.state.agentBusinessRuns?.[0].lineage).toEqual([f.value.parent,rootLink]);expect(f.state.runs).toHaveLength(1);
});
it('does not guess closure when transaction persistence fails',async()=>{
 const f=fixture();await f.service.Start(f.value);f.transact.mockRejectedValueOnce(Error('fsync unknown'));await expect(f.service.Close(f.value)).rejects.toThrow('fsync unknown');expect(f.state.agentBusinessRuns?.[0].status).toBe('active');
});
