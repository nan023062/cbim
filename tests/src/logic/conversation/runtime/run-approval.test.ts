import {FileRunStorage} from '../../../../../src/logic/execution/storage/run-storage';
import {test,expect} from 'vitest';
import {WorkspaceExecutionManager} from '../../../../../src/logic/conversation/runtime/execution-manager';
import {fixture} from '../../application/support/helpers';
test('approve all skips later confirmations only for the current run; next run asks again',async()=>{
 const f=await fixture();let manager:WorkspaceExecutionManager|undefined;try{
 const entry=await f.app.Dispatch('add',{path:f.a});const callbacks:any[]=[];const completions:((v:any)=>void)[]=[];
 manager=new WorkspaceExecutionManager(f.app.Workspace(entry.id),new FileRunStorage(),async options=>{callbacks.push(options);return {runtime:{start:async()=>({runId:'test-run',done:new Promise(resolve=>completions.push(resolve))}),close:async()=>{},stop:async()=>{}}} as any});
 const options={provider:'test',model:'test',permission:'ask' as const,allowNativeExecution:true};
 const first=await manager.Chat('one',options),second=await manager.Chat('two',options);
 const a=callbacks[0].requestApproval({name:'bash',input:{command:'echo one'}}),b=callbacks[1].requestApproval({name:'write',input:{path:'test.txt'}});
 const pending=manager.PendingApprovals(first.taskId)[0];manager.AnswerApproval(first.taskId,pending.id,true,true);
 expect(await a).toMatchObject({allow:true});expect(await callbacks[0].requestApproval({name:'edit',input:{}})).toMatchObject({allow:true});expect(manager.PendingApprovals(second.taskId)).toHaveLength(1);
 manager.AnswerApproval(second.taskId,manager.PendingApprovals(second.taskId)[0].id,false);expect(await b).toMatchObject({allow:false});
 completions[0]({status:'cancelled'});completions[1]({status:'cancelled'});
 await expect.poll(()=>(manager as any).active.size).toBe(0);
 await (manager as any).Launch({taskId:first.taskId,workspaceId:entry.id,root:f.a,goal:'again',moduleIds:[],acceptance:[],mode:'chat'},options);
 const c=callbacks[2].requestApproval({name:'bash',input:{}});expect(manager.PendingApprovals(first.taskId)).toHaveLength(1);
 manager.AnswerApproval(first.taskId,manager.PendingApprovals(first.taskId)[0].id,false);expect(await c).toMatchObject({allow:false});completions[2]({status:'cancelled'});
 }finally{await manager?.Close();await f.cleanup()}
});
