import {expect,test} from 'vitest';
import type {Snapshot} from '../src/bridge/contracts/workspace';
import {availableTeamSkills,buildTeamModel,MAIN_AGENT,TEAM_ROOT,visibleTeamNodes} from '../src/view/team/team-model';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {TeamView} from '../src/view/team/TeamView';

function snapshot(files:Record<string,string|object>):Snapshot{return {workspaceId:'w',instanceId:'i',revision:'r',files:Object.entries(files).map(([path,value])=>({path,text:typeof value==='string'?value:JSON.stringify(value),hash:'hash'}))}}
function skill(name:string){return {name,purpose:`${name}用途`,reference:`skills/${name}/SKILL.md`}}
const agentId=TEAM_ROOT+'/design/gameplay';
function fixture(){return snapshot({
  [TEAM_ROOT+'/skills.json']:{skills:[skill('shared')]},[TEAM_ROOT+'/skills/shared/SKILL.md']:'# 共享方法',
  [TEAM_ROOT+'/design/skills.json']:{skills:[skill('design')]},[TEAM_ROOT+'/design/skills/design/SKILL.md']:'# 设计方法',
  [agentId+'/agent.json']:{id:'malicious-id-is-not-authority',name:'玩法设计师',summary:'策划设计能力',capabilities:['玩法迭代'],limitations:['不设计美术资产'],work_principles:'principles.md',skills:[skill('playtest')]},
  [agentId+'/principles.md']:'# 原则\n保持真实验证。',[agentId+'/skills/playtest/SKILL.md']:'# 游玩测试',
  [TEAM_ROOT+'/art/skills.json']:{skills:[]},
})}
test('empty team retains two static read-only builtin roles and no fake custom agents',()=>{
  const model=buildTeamModel(undefined,'Project');
  expect(model.nodes[TEAM_ROOT].kind).toBe('team');expect(model.nodes[TEAM_ROOT].name).toBe('Project');
  expect(model.nodes[TEAM_ROOT].children).toEqual([MAIN_AGENT]);expect(model.nodes[MAIN_AGENT].kind).toBe('builtin');expect(model.nodes['cbim:executor']).toBeUndefined();
  expect(availableTeamSkills(model,MAIN_AGENT)).toEqual([]);
});
test('static snapshot preserves owner identities, principles and the complete Skill parent chain',()=>{
  const model=buildTeamModel(fixture(),'Project');
  expect(model.nodes['malicious-id-is-not-authority']).toBeUndefined();expect(model.nodes[agentId].body).toBe('# 原则\n保持真实验证。');
  expect(model.nodes[TEAM_ROOT+'/art'].kind).toBe('group');
  expect(availableTeamSkills(model,agentId).map(item=>[item.name,item.ownerId,item.inherited,item.available])).toEqual([
    ['playtest',agentId,false,true],['design',TEAM_ROOT+'/design',true,true],['shared',TEAM_ROOT,true,true],
  ]);
  expect(availableTeamSkills(model,MAIN_AGENT).map(item=>[item.name,item.inherited])).toEqual([['shared',true]]);
  expect(availableTeamSkills(model,MAIN_AGENT).map(item=>[item.name,item.inherited])).toEqual([['shared',true]]);
});
test('searching Skill or limitations retains ancestors but not unrelated groups',()=>{
  const model=buildTeamModel(fixture(),'Project');
  expect([...visibleTeamNodes(model,'playtest')]).toEqual([agentId,TEAM_ROOT+'/design',TEAM_ROOT]);
  expect(visibleTeamNodes(model,'美术资产').has(agentId)).toBe(true);
  expect(visibleTeamNodes(model,'不存在').size).toBe(0);expect(visibleTeamNodes(model,'').size).toBe(Object.keys(model.nodes).length);
});
test('malformed definitions and escaping references are reported without loading an unrelated body',()=>{
  const data=fixture();data.files.push({path:TEAM_ROOT+'/bad/agent.json',text:'{',hash:''});
  data.files.push({path:TEAM_ROOT+'/agent.json',text:JSON.stringify({name:'不能覆盖根'}),hash:''});
  data.files.find(file=>file.path===TEAM_ROOT+'/skills.json')!.text=JSON.stringify({skills:[skill('missing'),{name:'escape',reference:'../secret.md'}]});
  data.files.push({path:TEAM_ROOT+'/../secret.md',text:'DO_NOT_LOAD',hash:''});
  const model=buildTeamModel(data,'Project');
  expect(model.issues).toHaveLength(3);expect(model.nodes[TEAM_ROOT].kind).toBe('team');expect(model.nodes[TEAM_ROOT+'/bad']).toBeUndefined();
  expect(model.skills.find(item=>item.name==='missing')?.available).toBe(false);expect(JSON.stringify(model)).not.toContain('DO_NOT_LOAD');
});
test('team root cannot be edited or deleted and a different workspace snapshot is never displayed',()=>{
  const workspace={id:'w',path:'project',name:'Project',state:'running',tasks:[]};
  const html=renderToStaticMarkup(createElement(TeamView,{workspace,snapshot:fixture()}));
  const navigation=html.slice(html.indexOf('<nav'),html.indexOf('</nav>'));expect(navigation).not.toContain('agent.json');expect(navigation).not.toContain('SKILL.md');expect(navigation).not.toContain('principles.md');expect(html).not.toContain('<h1>');expect(navigation).toContain('一键治理');
  expect(html).toContain('团队组织树');expect(html).toContain('发布整个团队');expect(html).toContain('历史角色');
  expect(html).not.toContain('CBIM 主 Agent');expect(html).not.toContain('CBIM 默认执行 Agent');expect(html).not.toContain('data-agent-id="cbim:main"');expect(html).not.toContain('data-agent-id="cbim:executor"');
  const rootRow=html.slice(html.indexOf('data-team-id=".cbim/team"'),html.indexOf('data-team-id=".cbim/team/art"'));
  expect(rootRow).not.toContain('data-tree-action="agent-delete"');expect(rootRow).not.toContain('data-tree-action="agent-edit"');
  expect(html).toContain('data-tree-action="agent-delete"');expect(html).toContain('aria-label="玩法设计师的操作"');
  const isolated=renderToStaticMarkup(createElement(TeamView,{workspace:{...workspace,id:'other'},snapshot:fixture()}));
  expect(isolated).not.toContain('玩法设计师');expect(isolated).toContain('正在读取团队知识');
});
test('project tree hides builtins without changing the complete role model or inherited skills',()=>{
  const model=buildTeamModel(fixture(),'Project'),before=structuredClone(model);
  const visible=visibleTeamNodes(model,'',false);expect(visible.has(MAIN_AGENT)).toBe(false);expect(visible.has('cbim:executor')).toBe(false);expect(visible.has(agentId)).toBe(true);expect(visible.has(TEAM_ROOT+'/design')).toBe(true);
  expect(visibleTeamNodes(model,'cbim:executor',false).size).toBe(0);
  expect([...visibleTeamNodes(model,'playtest',false)]).toEqual([agentId,TEAM_ROOT+'/design',TEAM_ROOT]);
  expect(availableTeamSkills(model,MAIN_AGENT).map(item=>item.name)).toEqual(['shared']);expect(model).toEqual(before);
});
test('team tree includes empty and reference-only groups confirmed by the same snapshot registry',()=>{
  const data=fixture();data.validation={indexes:{[TEAM_ROOT+'/registry.json']:JSON.stringify({groups:[{id:TEAM_ROOT+'/empty'},{id:TEAM_ROOT+'/research/notes'}]})},issues:[],tree:{nodes:{},roots:[]},structural:true,architecture:'review-required',business:'not-run'};
  const model=buildTeamModel(data,'Project');
  expect(model.nodes[TEAM_ROOT+'/empty'].kind).toBe('group');
  expect(model.nodes[TEAM_ROOT+'/research'].children).toEqual([TEAM_ROOT+'/research/notes']);
  expect(visibleTeamNodes(model,'notes').has(TEAM_ROOT)).toBe(true);
});
