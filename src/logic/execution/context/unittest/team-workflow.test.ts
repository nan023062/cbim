// logic/execution/context: module-owned integration coverage; keep the original scenario and cleanup semantics.
import {required} from '../../../../../scripts/unittest/support/assertions';
import {FileRunStorage} from '../../storage/run-storage';
import {it,expect} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fixture} from '../../../application/unittest/support/helpers';
import {seedTeam} from '../../../knowledge/service/unittest/support/team-fixture';
import {knowledgeTools} from '../../../tools/runtime/knowledge-tools';
import {prepareTeamTask} from '../team-workflow';
import {WorkspaceExecutionManager} from '../../../conversation/runtime/execution-manager';
import {LoopRuntime} from '../../rules/index';

it('内部知识服务保留身份、写授权与 Schema 校验，团队准备冻结继承和本模块流程',async()=>{
  const f=await fixture();try{
    const e=await f.app.Dispatch('add',{path:f.a}),w=f.app.Workspace(e.id),service=knowledgeTools(w);
    await expect(fs.access(path.join(f.app.paths.Project(e.id),'discovery.json'))).rejects.toThrow();
    const seeded=await seedTeam(w),task=await f.app.Dispatch('loop.prepare',{id:e.id,task:seeded.input});
    expect(task.workflowContext).toMatchObject({agent:{skills:[{id:seeded.own},{id:seeded.shared}]}});
    expect(task.workflowContext).toMatchObject({workflow:{owner:seeded.input.moduleId}});
    expect(required(task.workflowContext).standards).toHaveLength(2);
    const choices=await f.app.Dispatch('loop.choices',{id:e.id});
    expect(required(choices.modules.find((m:any)=>m.id===seeded.input.moduleId)).workflows.some((w:any)=>w.id===seeded.input.workflowId)).toBe(true);
    expect(required(choices.modules.find((m:any)=>m.id===seeded.child)).workflows).toEqual([]);
    expect(choices.agents.some((a:any)=>a.id===seeded.input.agentId)).toBe(true);
    await expect(prepareTeamTask(w,{...seeded.input,moduleId:seeded.child})).rejects.toMatchObject({code:'WORKFLOW_SCOPE'});
    // 已退役的真人标识仅保留为旧任务说明，不查花名册、不代替正式岗位派发门禁。
    await expect(prepareTeamTask(w,{...seeded.input,responsiblePerson:'unknown'})).resolves.toMatchObject({responsiblePerson:'unknown',workflowContext:{revision:required(task.workflowContext).revision}});
    await expect(fs.access(path.join(f.a,'.cbim/team/people.json'))).rejects.toThrow();
    await expect(service.CallFromRun('cbim_agent_get',{workspaceId:e.id,instanceId:'stale',id:seeded.input.agentId},false)).rejects.toMatchObject({code:'STALE_INSTANCE'});
    await expect(seeded.call('cbim_knowledge_commit',{revision:required(task.workflowContext).revision,requestId:'no-permission',changes:[]})).rejects.toMatchObject({code:'FORBIDDEN'});
    await expect(service.CallFromRun('cbim_agent_get',{},false)).rejects.toThrow();
    expect(service.List().every(t=>t.inputSchema.type==='object')).toBe(true);
  }finally{await f.cleanup()}
});
