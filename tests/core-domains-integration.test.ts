import {it,expect} from 'vitest';
import {Team,BusinessWorkspace} from '../src/logic/knowledge/rules/read-models';
import {fixture} from './helpers';
import {seedTeam} from './team-fixture';

// 保留原完整应用场景，单独证明真实事务生成的快照在工作区关闭后仍能被读取。
it('真实工作区关闭后，已取得的领域快照保留 Skill 继承和本模块 Workflow',async()=>{
  const f=await fixture();try{
    const e=await f.app.dispatch('add',{path:f.a}),w=f.app.workspace(e.id),seed=await seedTeam(w),snapshot=await w.snapshot();
    const hr=new Team(snapshot),business=new BusinessWorkspace(snapshot);
    await f.app.stop(e.id);
    const agent=await hr.agent(seed.input.agentId);
    expect(agent.skills.map(s=>s.id)).toEqual([seed.own,seed.shared]);
    expect((await business.module(seed.input.moduleId)).workflows[0].id).toBe(seed.input.workflowId);
    expect((await business.module(seed.child)).workflows).toEqual([]);
  }finally{await f.cleanup()}
});
