import {expect,it} from 'vitest';
import {fixture} from '../../application/support/helpers';
import {request} from '../../knowledge/rules/data/knowledge';
import {seedTeam} from '../../knowledge/service/support/team-fixture';
import {json} from '../../../../../src/core/io/serialization';
import {resolveConversationAgent,resolveDispatchAgent,resolveDispatchModules} from '../../../../../src/logic/execution/context/dispatch-context';
// 故意保留旧维护关系输入，验证历史数据不参与当前派发；不再依赖已退出的生产类型。

const maintenance=(bindingId:string)=>({
  bindingId,maintainerPersonIds:['alice'],revision:1,state:'active',
  confirmation:{recordId:'local-review',source:'local_user',confirmedAt:'2026-11-06T00:00:00.000Z'},
});

it('默认执行员拒绝重新解析，自定义角色从真实知识版本继承 Skill',async()=>{
  const f=await fixture();
  try{
    const e=await f.app.Dispatch('add',{path:f.a}),w=f.app.Workspace(e.id);
    await expect(resolveDispatchAgent(await w.Snapshot(),'cbim:executor')).rejects.toThrow('内置默认执行 Agent 已退役');
    const seeded=await seedTeam(w),snapshot=await w.Snapshot();
    const custom=await resolveDispatchAgent(snapshot,seeded.input.agentId);
    await expect(resolveDispatchAgent(snapshot,'cbim:executor')).rejects.toThrow('内置默认执行 Agent 已退役');
    expect(custom.effectiveSkills.find(skill=>skill.inherited)).toMatchObject({ownerId:'.cbim/team',inherited:true,content:'# 团队校验规则'});
    await expect(resolveDispatchAgent(snapshot,'cbim:main')).rejects.toThrow('主 Agent 请在当前会话直接执行');
    expect(custom.effectiveSkills.map(s=>[s.skillId,s.inherited])).toEqual([[seeded.own,false],[seeded.shared,true]]);
    expect(custom.principles).toContain('验证实际结果');
    expect(custom.knowledgeRevision).toBe(snapshot.revision);
    await expect(resolveDispatchAgent(snapshot,'.cbim/team')).rejects.toThrow('成员角色不存在');
    await expect(resolveDispatchAgent(snapshot,'.cbim/team/missing')).rejects.toThrow('成员角色不存在');
  }finally{await f.cleanup()}
});

it('模块解析不再依赖真人、作者或旧维护声明，只冻结模块版本和各自 Workflow',async()=>{
  const f=await fixture();
  try{
    const e=await f.app.Dispatch('add',{path:f.a}),w=f.app.Workspace(e.id),seeded=await seedTeam(w);
    const snapshot=await w.Snapshot(),module=JSON.parse(snapshot.files.find(x=>x.path===seeded.input.moduleId+'/module.json')!.text);
    const fresh=await resolveDispatchModules(snapshot,[seeded.input.moduleId,seeded.child]);
    expect(fresh[0]).toMatchObject({moduleId:seeded.input.moduleId,workflow:{kind:'module',id:seeded.input.workflowId}});
    expect(fresh[1].workflow).toMatchObject({kind:'general',id:'cbim:general',version:'1'});
    expect(fresh.every(binding=>!('maintainerPersonIds' in binding)&&!('maintenanceBindingId' in binding))).toBe(true);
    module.authors=['未登记的历史作者'];module.maintenance={...maintenance('legacy-maintenance'),state:'retired'};
    await w.Commit(request(snapshot,[{path:seeded.input.moduleId+'/module.json',text:json(module)},{path:'.cbim/team/people.json',text:'旧花名册已不可解析，保留原字节'}]));
    const after=await w.Snapshot();expect(after.validation!.structural).toBe(true);
    expect((await resolveDispatchModules(after,[seeded.input.moduleId]))[0]).toEqual({...fresh[0],knowledgeRevision:after.revision});
    expect(after.files.find(file=>file.path==='.cbim/team/people.json')!.text).toBe('旧花名册已不可解析，保留原字节');
  }finally{await f.cleanup()}
});

it('废弃维护声明不阻塞旧数据，模块范围和真实知识校验继续生效',async()=>{
  const f=await fixture();
  try{
    const e=await f.app.Dispatch('add',{path:f.a}),w=f.app.Workspace(e.id),seeded=await seedTeam(w);
    const snapshot=await w.Snapshot(),module=JSON.parse(snapshot.files.find(x=>x.path===seeded.input.moduleId+'/module.json')!.text);
    module.maintenance={...maintenance('legacy'),confirmation:{recordId:'old',source:'local_user',confirmedAt:'旧历史时间'}};
    await w.Commit(request(snapshot,[{path:seeded.input.moduleId+'/module.json',text:json(module)}]));
    const saved=await w.Snapshot();expect(saved.validation!.structural).toBe(true);
    await expect(resolveDispatchModules(snapshot,[])).rejects.toThrow('不重复的真实模块 ID');
    await expect(resolveDispatchModules(snapshot,[seeded.child,seeded.child])).rejects.toThrow('不重复的真实模块 ID');
    await expect(resolveDispatchModules(snapshot,['.cbim/workspace/missing'])).rejects.toThrow('模块不存在');
    const invalid={...snapshot,validation:{...snapshot.validation!,structural:false}};
    expect(resolveConversationAgent(invalid)).toMatchObject({agentId:'cbim:main',workspaceId:e.id,knowledgeRevision:snapshot.revision,source:'builtin',effectiveSkills:[]});
    expect(()=>resolveConversationAgent({...invalid,workspaceId:''})).toThrowError('主会话身份登记需要有效工作区和知识版本');
    expect(()=>resolveConversationAgent({...invalid,revision:''})).toThrowError('主会话身份登记需要有效工作区和知识版本');
    await expect(resolveDispatchAgent(invalid,'cbim:main')).rejects.toThrow('派发需要通过结构校验的知识快照');
    await expect(resolveDispatchModules(invalid,[seeded.child])).rejects.toThrow('派发需要通过结构校验的知识快照');
    expect((await w.Snapshot()).revision).toBe(saved.revision);
  }finally{await f.cleanup()}
});
