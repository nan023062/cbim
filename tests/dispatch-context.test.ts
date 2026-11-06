import {expect,it} from 'vitest';
import {fixture,request} from './helpers';
import {seedTeam} from './team-fixture';
import {json} from '../src/backend/core/foundation/serialization';
import {resolveDispatchAgent,resolveDispatchModules} from '../src/backend/scheduler-engine/context/dispatch-context';
import type {ModuleMaintenanceDefinition} from '../src/backend/core/workspace/maintenance';

const maintenance=(bindingId:string):ModuleMaintenanceDefinition=>({
  bindingId,maintainerPersonIds:['alice'],revision:1,state:'active',
  confirmation:{recordId:'local-review',source:'local_user',confirmedAt:'2026-11-06T00:00:00.000Z'},
});

it('主角色和自定义角色从同一真实知识版本解析，主角色只继承 Team 根 Skill',async()=>{
  const f=await fixture();
  try{
    const e=await f.app.dispatch('add',{path:f.a}),w=f.app.workspace(e.id);
    const empty=await resolveDispatchAgent(await w.snapshot(),'cbim:main');
    expect(empty).toMatchObject({agentId:'cbim:main',workspaceId:e.id,source:'builtin',effectiveSkills:[]});
    const seeded=await seedTeam(w),snapshot=await w.snapshot();
    const main=await resolveDispatchAgent(snapshot,'cbim:main'),custom=await resolveDispatchAgent(snapshot,seeded.input.agentId);
    expect(main.effectiveSkills.map(s=>s.skillId)).toEqual([seeded.shared]);
    expect(main.effectiveSkills[0]).toMatchObject({ownerId:'.cbim/team',inherited:true,content:'# 团队校验规则'});
    expect(custom.effectiveSkills.map(s=>[s.skillId,s.inherited])).toEqual([[seeded.own,false],[seeded.shared,true]]);
    expect(custom.principles).toContain('验证实际结果');
    expect(custom.knowledgeRevision).toBe(snapshot.revision);
    await expect(resolveDispatchAgent(snapshot,'.cbim/team')).rejects.toMatchObject({code:'AGENT_MISSING'});
    await expect(resolveDispatchAgent(snapshot,'.cbim/team/missing')).rejects.toMatchObject({code:'AGENT_MISSING'});
  }finally{await f.cleanup()}
});

it('作者不自动变成维护人；显式知识提交后冻结多模块责任和各自 Workflow',async()=>{
  const f=await fixture();
  try{
    const e=await f.app.dispatch('add',{path:f.a}),w=f.app.workspace(e.id),seeded=await seedTeam(w);
    let snapshot=await w.snapshot();
    const module=JSON.parse(snapshot.files.find(x=>x.path===seeded.input.moduleId+'/module.json')!.text);
    const child=JSON.parse(snapshot.files.find(x=>x.path===seeded.child+'/module.json')!.text);
    module.authors=['alice'];
    await w.commit(request(snapshot,[
      {path:'.cbim/team/people.json',text:json({people:[{id:'alice',name:'Alice',team:'.cbim/team'}]})},
      {path:seeded.input.moduleId+'/module.json',text:json(module)},
    ]));
    snapshot=await w.snapshot();
    await expect(resolveDispatchModules(snapshot,[seeded.input.moduleId])).rejects.toMatchObject({code:'MAINTAINER_UNCONFIRMED'});
    module.maintenance=maintenance('game-maintenance');child.maintenance=maintenance('child-maintenance');
    await w.commit(request(snapshot,[
      {path:seeded.input.moduleId+'/module.json',text:json(module)},
      {path:seeded.child+'/module.json',text:json(child)},
    ]));
    snapshot=await w.snapshot();
    const bindings=await resolveDispatchModules(snapshot,[seeded.input.moduleId,seeded.child]);
    expect(bindings[0]).toMatchObject({moduleId:seeded.input.moduleId,maintenanceBindingId:'game-maintenance',maintainerPersonIds:['alice'],knowledgeRevision:snapshot.revision,workflow:{kind:'module',id:seeded.input.workflowId}});
    expect(bindings[1].workflow).toMatchObject({kind:'general',id:'cbim:general',version:'1'});
    expect(bindings[1].knowledgeRevision).toBe(bindings[0].knowledgeRevision);
    module.maintenance.state='retired';
    await w.commit(request(snapshot,[{path:seeded.input.moduleId+'/module.json',text:json(module)}]));
    await expect(resolveDispatchModules(await w.snapshot(),[seeded.input.moduleId])).rejects.toMatchObject({code:'MAINTAINER_UNCONFIRMED'});
    expect(bindings[0].maintainerPersonIds).toEqual(['alice']);
  }finally{await f.cleanup()}
});

it('维护关系引用、时间、唯一标识及调用范围不能绕过真实知识校验',async()=>{
  const f=await fixture();
  try{
    const e=await f.app.dispatch('add',{path:f.a}),w=f.app.workspace(e.id),seeded=await seedTeam(w);
    const snapshot=await w.snapshot(),module=JSON.parse(snapshot.files.find(x=>x.path===seeded.input.moduleId+'/module.json')!.text);
    module.maintenance=maintenance('game-maintenance');
    const definition=()=>({path:seeded.input.moduleId+'/module.json',text:json(module)});
    await expect(w.commit(request(snapshot,[definition()]))).rejects.toMatchObject({code:'VALIDATION'});
    const people={path:'.cbim/team/people.json',text:json({people:[{id:'alice',name:'Alice',team:'.cbim/team'}]})};
    module.maintenance.confirmation.confirmedAt='2026-02-31T00:00:00.000Z';
    await expect(w.commit(request(snapshot,[people,definition()]))).rejects.toMatchObject({code:'VALIDATION'});
    module.maintenance.confirmation.confirmedAt='2026-11-06T00:00:00.000Z';
    const child=JSON.parse(snapshot.files.find(x=>x.path===seeded.child+'/module.json')!.text);child.maintenance=module.maintenance;
    await expect(w.commit(request(snapshot,[people,definition(),{path:seeded.child+'/module.json',text:json(child)}]))).rejects.toMatchObject({code:'VALIDATION'});
    await expect(resolveDispatchModules(snapshot,[])).rejects.toMatchObject({code:'MODULE_MISSING'});
    await expect(resolveDispatchModules(snapshot,[seeded.child,seeded.child])).rejects.toMatchObject({code:'MODULE_MISSING'});
    await expect(resolveDispatchModules(snapshot,['.cbim/workspace/missing'])).rejects.toMatchObject({code:'MODULE_MISSING'});
    const invalid={...snapshot,validation:{...snapshot.validation!,structural:false}};
    await expect(resolveDispatchAgent(invalid,'cbim:main')).rejects.toMatchObject({code:'KNOWLEDGE_INVALID'});
    await expect(resolveDispatchModules(invalid,[seeded.child])).rejects.toMatchObject({code:'KNOWLEDGE_INVALID'});
    expect((await w.snapshot()).revision).toBe(snapshot.revision);
  }finally{await f.cleanup()}
});
