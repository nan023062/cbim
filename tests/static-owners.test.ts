import {expect,it} from 'vitest';
import {teamGroupIds} from '../src/frontend/knowledge/static-owners';
import type {Snapshot} from '../src/bridge/contracts/workspace';

it('编辑与导入可选择没有自身 Skill 清单的祖先组，但 Agent 叶子不可作为组',()=>{
  const snapshot={files:[
    {path:'.cbim/team/engineering/client/developer/agent.json'},
    {path:'.cbim/team/engineering/client/developer/skills.json'},
    {path:'.cbim/team/art/skills.json'},
    {path:'.cbim/workspace/game/module.json'},
  ]} as Snapshot;
  expect(teamGroupIds(snapshot)).toEqual(['.cbim/team','.cbim/team/art','.cbim/team/engineering','.cbim/team/engineering/client']);
});
it('空工作区仍提供唯一 Team 根，既不创建定义也不推断运行成员',()=>{
  const snapshot={files:[]} as unknown as Snapshot;
  expect(teamGroupIds(snapshot)).toEqual(['.cbim/team']);
  expect(snapshot.files).toEqual([]);
});
it('纳入规则索引中的空组和辅助正文组，拒绝越界与 Agent 下的伪造小组',()=>{
  const snapshot={files:[{path:'.cbim/team/developer/agent.json'}],validation:{indexes:{'.cbim/team/registry.json':JSON.stringify({groups:[{id:'.cbim/team/empty/nested'},{id:'.cbim/team/reference_only'},{id:'.cbim/team/developer/invalid'},{id:'.cbim/teamish'},{id:'.cbim/team/../escape'}]})}}} as unknown as Snapshot;
  expect(teamGroupIds(snapshot)).toEqual(['.cbim/team','.cbim/team/empty','.cbim/team/empty/nested','.cbim/team/reference_only']);
});
it('损坏的派生索引不会覆盖从定义路径确认的归属',()=>{
  const snapshot={files:[{path:'.cbim/team/design/member/agent.json'}],validation:{indexes:{'.cbim/team/registry.json':'{'}}} as unknown as Snapshot;
  expect(teamGroupIds(snapshot)).toEqual(['.cbim/team','.cbim/team/design']);
});
