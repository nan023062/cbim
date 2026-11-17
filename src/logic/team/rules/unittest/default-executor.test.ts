import {expect,test} from 'vitest';
import {fixture} from '../../../application/unittest/support/helpers';
import {knowledgeTools} from '../../../tools/runtime/knowledge-tools';
import {resolveConversationAgent,resolveDispatchAgent} from '../../../execution/context/dispatch-context';

test('空团队不再提供内置执行员，主会话保持唯一身份且旧角色不能重新派发',async()=>{
  const f=await fixture();
  try{
    const entry=await f.app.Dispatch('add',{path:f.a}),w=f.app.Workspace(entry.id),before=await w.Snapshot(),tools=knowledgeTools(w),identity={workspaceId:entry.id,instanceId:w.instanceId};
    const call=async(name:string,args:Record<string,unknown>={})=>{const result=await tools.CallFromRun(name,{...identity,...args},false);return JSON.parse((result.content[0] as {text:string}).text)};
    const registry=await call('cbim_agent_registry');expect(registry.builtinAgents).toEqual([]);
    expect((await call('cbim_agent_registry',{query:'executor'})).builtinAgents).toHaveLength(0);expect((await call('cbim_agent_registry',{query:'unrelated'})).builtinAgents).toEqual([]);
    await expect(call('cbim_agent_get',{id:'cbim:executor'})).rejects.toMatchObject({code:'AGENT_RETIRED'});
    await expect(resolveDispatchAgent(before,'cbim:executor')).rejects.toMatchObject({code:'AGENT_RETIRED'});
    const discovery=await f.app.MemberDispatch(entry.id).owners.Discover(['cbim:project']);
    expect(discovery.groups).toEqual([{moduleIds:['cbim:project'],execution:'main',agentId:'cbim:main',issues:[]}]);
    expect(resolveConversationAgent(before).agentId).toBe('cbim:main');await expect(resolveDispatchAgent(before,'cbim:main')).rejects.toMatchObject({code:'AGENT_ROLE_INVALID'});
    expect((await w.Snapshot()).files).toEqual(before.files);
  }finally{await f.cleanup()}
});
