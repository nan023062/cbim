import {expect,it,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {WorkspaceMemberTools} from '../src/backend/scheduler-engine/tools/workspace-member-tools';
import {workspaceMemberMainCommandId} from '../src/logic/team/rules/workspace-member-rules';
const binding={workspaceId:'workspace',instanceId:randomUUID(),rootSessionId:'root',scopeId:randomUUID(),agentInstanceId:randomUUID(),agentSessionId:randomUUID(),runId:randomUUID()};
const {workspaceId,instanceId:_,...source}=binding;
const commandId=workspaceMemberMainCommandId(workspaceId,{kind:'main_agent',...source,toolCallId:'call',toolName:'cbim_member_change_commit'});
const memberId=randomUUID(),streamId=randomUUID(),basis='a'.repeat(64),identity={workspaceId,instanceId:binding.instanceId};
const input={change:{kind:'state',memberId,expectedRevision:1,nextState:'suspended',reason:'pause'},expectedRegistryCursor:{kind:'workspace_registry',workspaceId,streamId,seq:1},expectedBasis:basis};
const output=()=>({identity,status:'recorded',commandId,receipt:{identity,commandId,action:'state',changeId:randomUUID(),memberId,previousRevision:1,memberRevision:2,registryCursor:{kind:'workspace_registry',workspaceId,streamId,seq:2},basis,memberHash:'b'.repeat(64),committedAt:new Date().toISOString()}});
it('提交端口仅执行一次，坏回包与迟到取消均保留原命令而不重试',async()=>{
 for(const mode of ['wrong-member','wrong-command','throw','cancel']){
  const controller=new AbortController(),call=vi.fn(async()=>{const value=output();if(mode==='throw')throw Error('lost reply');if(mode==='wrong-member')value.receipt.memberId=randomUUID();if(mode==='wrong-command')value.receipt.commandId=randomUUID();if(mode==='cancel')controller.abort();return value});
  await expect(new WorkspaceMemberTools({call},binding).call('cbim_member_change_commit',input,controller.signal,'call')).rejects.toThrow(commandId);
  expect(call).toHaveBeenCalledTimes(1);
 }
});
it('拒绝自报 actor 和未知工具，回执未知保持只读',async()=>{
 const call=vi.fn(async()=>({identity,status:'unknown',commandId})),tools=new WorkspaceMemberTools({call},binding);
 await expect(tools.call('cbim_member_change_commit',{...input,actor:{kind:'local_desktop'}},new AbortController().signal,'call')).rejects.toThrow();expect(call).not.toHaveBeenCalled();
 expect(()=>tools.describe('cbim_member_change_unchecked',{})).toThrow();
 expect(JSON.parse((await tools.call('cbim_member_receipt',{commandId},new AbortController().signal)).content[0].text)).toMatchObject({status:'unknown',commandId});
});
