import {it,expect} from 'vitest';
import {Team,BusinessWorkspace} from '../read-models/index';
import {fixture} from '../../../application/unittest/support/helpers';
import {seedTeam} from '../../service/unittest/support/team-fixture';

// 保留原完整应用场景，单独证明真实事务生成的快照在工作区关闭后仍能被读取。
it('真实工作区关闭后，已取得的领域快照保留 Skill 继承和本模块 Workflow',async()=>{
  const f=await fixture();try{
    const e=await f.app.Dispatch('add',{path:f.a}),w=f.app.Workspace(e.id),seed=await seedTeam(w),snapshot=await w.Snapshot();
    const hr=new Team(snapshot),business=new BusinessWorkspace(snapshot);
    await f.app.Stop(e.id);
    const agent=await hr.Agent(seed.input.agentId);
    expect(agent.skills.map(s=>s.id)).toEqual([seed.own,seed.shared]);
    expect((await business.Module(seed.input.moduleId)).workflows[0].id).toBe(seed.input.workflowId);
    expect((await business.Module(seed.child)).workflows).toEqual([]);
  }finally{await f.cleanup()}
});
