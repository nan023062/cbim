import {it,expect} from 'vitest';
import {Team,BusinessWorkspace,content} from '../src/logic/knowledge/rules/read-models';
import {domainSnapshot} from './data/domain-snapshot';

it('核心领域在固定快照上解析团队 Skill 和本模块 Workflow，无需 main 实例',async()=>{
  const seed=domainSnapshot(),before=structuredClone(seed.snapshot);
  const hr=new Team(seed.snapshot),business=new BusinessWorkspace(seed.snapshot);
  const agent=await hr.agent(seed.agentId);
  expect(agent.skills.map(s=>s.id)).toEqual([seed.own,seed.shared]);
  expect(agent.skills.map(s=>s.inherited)).toEqual([false,true]);
  expect((await business.module(seed.moduleId)).workflows[0].id).toBe(seed.workflowId);
  expect((await business.module(seed.child)).workflows).toEqual([]);
  expect(seed.snapshot).toEqual(before);
});
it('固定快照缺对象或正文时明确报告，不从磁盘补造资料',async()=>{
  const {snapshot,agentId}=domainSnapshot();
  await expect(new Team(snapshot).agent('.cbim/team/missing')).rejects.toMatchObject({code:'OBJECT_NOT_FOUND'});
  await expect(new BusinessWorkspace(snapshot).module('.cbim/workspace/missing')).rejects.toMatchObject({code:'OBJECT_NOT_FOUND'});
  expect(content(snapshot,agentId,'missing.md')).toMatchObject({available:false});
  expect(content(snapshot,agentId,'../../../secret.md')).toMatchObject({available:false,reason:'引用越界'});
});
