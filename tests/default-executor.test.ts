import {expect,test} from 'vitest';
import {fixture} from './helpers';
import {knowledgeTools} from '../src/backend/scheduler-engine/tools/knowledge-tools';
import {resolveConversationAgent,resolveDispatchAgent} from '../src/backend/scheduler-engine/context/dispatch-context';
import {defaultExecutorId,defaultExecutorDefinition} from '../src/backend/scheduler-engine/context/default-executor';

test('空团队可发现和读取静态默认执行角色，正式解析不创建项目文件且拒绝主调度执行',async()=>{
  const f=await fixture();
  try{
    const entry=await f.app.dispatch('add',{path:f.a}),w=f.app.workspace(entry.id),before=await w.snapshot(),tools=knowledgeTools(w),identity={workspaceId:entry.id,instanceId:w.instanceId};
    const call=async(name:string,args:Record<string,unknown>={})=>{const result=await tools.callFromRun(name,{...identity,...args},false);return JSON.parse((result.content[0] as {text:string}).text)};
    const registry=await call('cbim_agent_registry');expect(registry.builtinAgents).toEqual([defaultExecutorDefinition]);
    expect((await call('cbim_agent_registry',{query:'executor'})).builtinAgents).toHaveLength(1);expect((await call('cbim_agent_registry',{query:'unrelated'})).builtinAgents).toEqual([]);
    const detail=await call('cbim_agent_get',{id:defaultExecutorId});expect(detail).toMatchObject({id:defaultExecutorId,source:'builtin',definition:defaultExecutorDefinition,skills:[],skillSelectionValid:true});expect(detail.principles.text).toContain('独立于主调度 Agent');
    const prepared=await resolveDispatchAgent(before,defaultExecutorId);expect(prepared).toMatchObject({agentId:defaultExecutorId,source:'builtin',effectiveSkills:[]});
    expect(resolveConversationAgent(before).agentId).toBe('cbim:main');await expect(resolveDispatchAgent(before,'cbim:main')).rejects.toMatchObject({code:'AGENT_ROLE_INVALID'});
    expect((await w.snapshot()).files).toEqual(before.files);
  }finally{await f.cleanup()}
});
