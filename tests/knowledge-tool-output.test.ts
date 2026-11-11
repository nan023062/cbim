import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {expect,it} from 'vitest';
import {z} from 'zod';
import {fixture} from './helpers';
import {internalKnowledge} from './knowledge-tool-fixture';
import {summary} from './data/knowledge';
import {seedTeam} from './team-fixture';
import {builtinSkills} from '../src/backend/core/knowledge/builtins';
import {content} from '../src/backend/core/knowledge/read-models';
import {
  jsonValueSchema,knowledgeSnapshotOutputSchema,knowledgeSearchOutputSchema,workspaceIdentityOutputSchema,
} from '../src/backend/core/knowledge/tool-output-base';
import {
  moduleRegistryOutputSchema,moduleGetOutputSchema,agentRegistryOutputSchema,agentGetOutputSchema,knowledgeContentOutputSchema,
} from '../src/backend/core/knowledge/tool-output-queries';
import {builtinCatalogOutputSchema,builtinReadOutputSchema} from '../src/backend/core/knowledge/tool-output-builtins';
import {
  knowledgePreviewOutputSchema,knowledgeCommitOutputSchema,objectPreviewOutputSchema,objectCommitOutputSchema,knowledgeRefreshOutputSchema,
  maintenanceTaskOutputSchema,maintenanceTaskStatusOutputSchema,
} from '../src/backend/core/knowledge/tool-output-transactions';

/** 对真实传输快照作严格校验，任何裁剪、默认值或类型转换都不算通过。 */
function accepts<T>(schema:z.ZodTypeAny,value:T):T{
  const wire=JSON.parse(JSON.stringify(value));expect(schema.parse(wire)).toEqual(wire);return wire;
}

it('真实知识查询、内置资料及所有Skill别名保留原输出，内置和自定义角色分别校验',async()=>{
  const f=await fixture();try{
    const entry=await f.app.dispatch('add',{path:f.a}),ws=f.app.workspace(entry.id),seeded=await seedTeam(ws),{call}=internalKnowledge(ws);
    accepts(workspaceIdentityOutputSchema,await call('cbim_workspace_identity'));
    const snapshot=accepts(knowledgeSnapshotOutputSchema,await call('cbim_knowledge_snapshot'));
    const found=accepts(knowledgeSearchOutputSchema,await call('cbim_knowledge_search',{query:'module.json'}));
    expect(found.revision).toBe(snapshot.revision);expect(found.files.length).toBeLessThan(snapshot.files.length);expect(found.validation).toBeUndefined();
    accepts(moduleRegistryOutputSchema,await call('cbim_module_registry'));
    const module=accepts(moduleGetOutputSchema,await call('cbim_module_get',{id:seeded.input.moduleId}));expect(module.workflows[0].inherited).toBe(false);
    const registry=accepts(agentRegistryOutputSchema,await call('cbim_agent_registry'));expect(registry.builtinAgents).toEqual([]);
    const own=accepts(agentGetOutputSchema,await call('cbim_agent_get',{id:seeded.input.agentId}));expect(own.definitionFile.path).toContain('/agent.json');expect(own.skills.some((skill:any)=>skill.inherited)).toBe(true);
    await expect(call('cbim_agent_get',{id:'cbim:executor'})).rejects.toMatchObject({code:'AGENT_RETIRED'});
    await expect(call('cbim_people_list')).rejects.toThrow();
    const catalog=accepts(builtinCatalogOutputSchema,await call('cbim_builtin_catalog'));
    for(const item of catalog.items)accepts(builtinReadOutputSchema,await call('cbim_builtin_read',{id:item.id,expectedVersion:item.version}));
    for(const skill of builtinSkills)accepts(builtinReadOutputSchema,await call('cbim_skill_'+skill.id.replaceAll('-','_')));
    // 服务字段和正文结构仍严格；不能通过多余授权字段、缺失哈希或非布尔只读标志放行。
    expect(workspaceIdentityOutputSchema.safeParse({...await call('cbim_workspace_identity'),approved:true}).success).toBe(false);
    expect(moduleGetOutputSchema.safeParse({...module,overview:{available:true,text:'text',path:'file'}}).success).toBe(false);
    expect(builtinReadOutputSchema.safeParse({...await call('cbim_builtin_read',{id:catalog.entryId}),readOnly:'true'}).success).toBe(false);
  }finally{await f.cleanup()}
});

it('旧花名册不再提供查询或作者映射，其他无效知识仍能完整诊断',async()=>{
  const f=await fixture();try{
    const entry=await f.app.dispatch('add',{path:f.a}),ws=f.app.workspace(entry.id),seeded=await seedTeam(ws),{call}=internalKnowledge(ws);
    const people=[{id:'raw-person',name:42,team:null,unexpected:{retain:[true,null,'fact']}}];
    await fs.writeFile(path.join(f.a,'.cbim/team/people.json'),JSON.stringify({people}));
    const agentPath=path.join(f.a,seeded.input.agentId,'agent.json'),agent=JSON.parse(await fs.readFile(agentPath,'utf8'));agent.authors=['raw-person'];await fs.writeFile(agentPath,JSON.stringify(agent));
    const modulePath=path.join(f.a,seeded.input.moduleId,'module.json'),module=JSON.parse(await fs.readFile(modulePath,'utf8'));module.summary=summary.repeat(3);await fs.writeFile(modulePath,JSON.stringify(module));
    const snapshot=accepts(knowledgeSnapshotOutputSchema,await call('cbim_knowledge_snapshot'));expect(snapshot.validation.structural).toBe(false);
    const registry=accepts(agentRegistryOutputSchema,await call('cbim_agent_registry'));expect(registry.groups.flatMap((group:any)=>group.agents)[0].authorPeople).toEqual([]);
    const detail=accepts(moduleGetOutputSchema,await call('cbim_module_get',{id:seeded.input.moduleId}));expect(detail.structural).toBe(false);expect(detail.definition.summary).toBe(summary.repeat(3));
    await fs.writeFile(path.join(f.a,'.cbim/team/people.json'),'不再解析的历史内容');
    const legacy=await ws.snapshot();expect(legacy.validation!.issues.some(issue=>issue.path==='.cbim/team/people.json')).toBe(false);
    expect(legacy.files.find(file=>file.path==='.cbim/team/people.json')!.text).toBe('不再解析的历史内容');
    await expect(call('cbim_people_list')).rejects.toThrow();
  }finally{await f.cleanup()}
});

it('空正文、缺失引用与Skill继承冲突仍保留明确可用状态',async()=>{
  const f=await fixture();try{
    const entry=await f.app.dispatch('add',{path:f.a}),ws=f.app.workspace(entry.id),seeded=await seedTeam(ws),{call}=internalKnowledge(ws);
    await fs.writeFile(path.join(f.a,seeded.input.moduleId,'module.md'),'');await fs.unlink(path.join(f.a,seeded.input.workflowId,'workflow.md'));
    const agentPath=path.join(f.a,seeded.input.agentId,'agent.json'),definition=JSON.parse(await fs.readFile(agentPath,'utf8'));definition.skills[0].name='review';await fs.writeFile(agentPath,JSON.stringify(definition));
    await fs.unlink(path.join(f.a,seeded.input.agentId,definition.work_principles));
    const module=accepts(moduleGetOutputSchema,await call('cbim_module_get',{id:seeded.input.moduleId}));
    expect(module.overview).toMatchObject({available:true,text:''});expect(module.workflows[0].content).toMatchObject({available:false,reference:'workflows/build/workflow.md'});
    const agent=accepts(agentGetOutputSchema,await call('cbim_agent_get',{id:seeded.input.agentId}));expect(agent.skillSelectionValid).toBe(false);expect(agent.skillConflicts.length).toBeGreaterThan(0);expect(agent.principles.available).toBe(false);
    const snapshot=await ws.snapshot();expect(accepts(knowledgeContentOutputSchema,content(snapshot,seeded.input.moduleId,{invalid:['reference']}))).toEqual({available:false,reference:{invalid:['reference']}});
    expect(accepts(knowledgeContentOutputSchema,content(snapshot,seeded.input.moduleId,undefined))).toEqual({available:false});
    expect(knowledgeContentOutputSchema.safeParse({available:true,text:''}).success).toBe(false);
  }finally{await f.cleanup()}
});

it('原知识预览、移动预览和同请求提交幂等，空变更和对象预览诊断不误拒',async()=>{
  const f=await fixture();try{
    const entry=await f.app.dispatch('add',{path:f.a}),ws=f.app.workspace(entry.id),{call}=internalKnowledge(ws);
    const before=await ws.snapshot(),input={revision:before.revision,requestId:randomUUID(),changes:[]};
    accepts(knowledgePreviewOutputSchema,await call('cbim_knowledge_preview',input));
    const committed=accepts(knowledgeCommitOutputSchema,await call('cbim_knowledge_commit',input,true));expect(committed.changed).toEqual([]);
    expect(accepts(knowledgeCommitOutputSchema,await call('cbim_knowledge_commit',input,true))).toEqual(committed);
    accepts(knowledgePreviewOutputSchema,await call('cbim_knowledge_move_preview',{from:'.cbim/README.md',to:'.cbim/notes.md'}));
    const current=await ws.snapshot();
    const empty=accepts(knowledgePreviewOutputSchema,await call('cbim_knowledge_preview',{revision:current.revision,requestId:randomUUID(),changes:[{path:'.cbim/README.md',text:''}]}));expect(empty.changes.some((item:any)=>item.text==='')).toBe(true);
    const invalid=accepts(objectPreviewOutputSchema,await call('cbim_object_preview',{revision:current.revision,operations:[{kind:'agent',action:'create',parentId:'.cbim/team',slug:'invalid',data:{name:'Invalid',summary:'short',capabilities:['read']},body:'# Principles'}]}));
    expect(invalid.validation.structural).toBe(false);
    await expect(call('cbim_object_commit',{planId:invalid.planId},true)).rejects.toMatchObject({code:'VALIDATION'});
    expect(knowledgeCommitOutputSchema.safeParse({...committed,state:'rolled_back'}).success).toBe(false);
    expect(knowledgePreviewOutputSchema.safeParse({...invalid,planId:undefined,objects:undefined,notice:undefined,committed:true}).success).toBe(false);
  }finally{await f.cleanup()}
});

it('对象提交保留已提交结果和空目录清理警告，不将警告误报为事务回滚',async()=>{
  const f=await fixture();try{
    const entry=await f.app.dispatch('add',{path:f.a}),ws=f.app.workspace(entry.id),{call}=internalKnowledge(ws);
    const create=accepts(objectPreviewOutputSchema,await call('cbim_object_preview',{revision:(await ws.snapshot()).revision,operations:[{kind:'skill',action:'create',parentId:'.cbim/team',slug:'temporary',data:{name:'temporary',purpose:'test'},body:'# Temporary'}]}));
    accepts(objectCommitOutputSchema,await call('cbim_object_commit',{planId:create.planId},true));
    const remove=accepts(objectPreviewOutputSchema,await call('cbim_object_preview',{revision:(await ws.snapshot()).revision,operations:[{kind:'skill',action:'delete',id:create.objects[0]}]}));expect(remove.changes.some((item:any)=>item.text===null)).toBe(true);
    const prune=ws.objects.pruneEmpty;ws.objects.pruneEmpty=async()=>{throw Error('isolated cleanup failure')};
    try{
      const result=accepts(objectCommitOutputSchema,await call('cbim_object_commit',{planId:remove.planId},true));expect(result.state).toBe('committed');expect(result.cleanupWarnings).toEqual([expect.stringContaining('isolated cleanup failure')]);
      expect(accepts(objectCommitOutputSchema,await call('cbim_object_commit',{planId:remove.planId},true)).revision).toBe(result.revision);
      expect((await ws.read()).files.some(file=>file.path.endsWith('/temporary/SKILL.md'))).toBe(false);
    }finally{ws.objects.pruneEmpty=prune}
  }finally{await f.cleanup()}
});

it('刷新可能未写入，也可能刷新后才发现外部知识变坏，两种诊断均有效',async()=>{
  const f=await fixture();try{
    const entry=await f.app.dispatch('add',{path:f.a}),ws=f.app.workspace(entry.id),{call}=internalKnowledge(ws),readme=path.join(f.a,'.cbim/README.md');
    await fs.writeFile(readme,'[missing](../../../missing.md)');const invalid=accepts(knowledgeRefreshOutputSchema,await call('cbim_knowledge_refresh',{revision:(await call('cbim_knowledge_snapshot')).revision,requestId:randomUUID()},true));expect(invalid).toMatchObject({state:'invalid',indexesUpdated:false,structural:false});
    await fs.writeFile(readme,'# Valid');expect(accepts(knowledgeRefreshOutputSchema,await call('cbim_knowledge_refresh',{revision:(await call('cbim_knowledge_snapshot')).revision,requestId:randomUUID()},true))).toMatchObject({state:'refreshed',indexesUpdated:true});
    const refreshInput={revision:(await ws.snapshot()).revision,requestId:randomUUID()};const snapshot=ws.snapshot.bind(ws);let reads=0;ws.snapshot=async()=>{if(++reads===2)await fs.writeFile(readme,'[external change](../../../missing.md)');return snapshot()};
    try{expect(accepts(knowledgeRefreshOutputSchema,await call('cbim_knowledge_refresh',refreshInput,true))).toMatchObject({state:'invalid',indexesUpdated:true,structural:false})}finally{ws.snapshot=snapshot}
    expect(knowledgeRefreshOutputSchema.safeParse({...invalid,state:'refreshed'}).success).toBe(false);
  }finally{await f.cleanup()}
});

it('真实维护任务的运行、取消、失败、完成和not_found分支不混同业务任务',async()=>{
  const f=await fixture();try{
    const entry=await f.app.dispatch('add',{path:f.a}),ws=f.app.workspace(entry.id),{call}=internalKnowledge(ws);
    const started=accepts(maintenanceTaskOutputSchema,await call('cbim_rules_validate'));expect(started.name).toBe('validate');await expect.poll(()=>ws.tasks.get(started.id)?.state).toBe('completed');
    const completed=accepts(maintenanceTaskStatusOutputSchema,await call('cbim_task_status',{taskId:started.id}));expect(completed.result.business).toBe('not-run');
    const pending=ws.startTask('validate');accepts(maintenanceTaskOutputSchema,ws.cancelTask(pending.id));await expect.poll(()=>pending.state).toBe('cancelled');
    const cancelled=accepts(maintenanceTaskOutputSchema,await call('cbim_task_cancel',{taskId:pending.id}));expect(cancelled.state).toBe('cancelled');expect(accepts(maintenanceTaskOutputSchema,await call('cbim_task_cancel',{taskId:pending.id}))).toEqual(cancelled);
    const reindex=ws.startTask('reindex');await expect.poll(()=>reindex.state).toBe('completed');expect(accepts(maintenanceTaskStatusOutputSchema,await call('cbim_task_status',{taskId:reindex.id})).result.state).toBe('committed');
    const validate=ws.rules.validate;ws.rules.validate=async()=>{throw Error('isolated validation failure')};
    try{const failed=ws.startTask('validate');await expect.poll(()=>failed.state).toBe('failed');expect(accepts(maintenanceTaskStatusOutputSchema,await call('cbim_task_status',{taskId:failed.id})).error).toBe('isolated validation failure')}finally{ws.rules.validate=validate}
    expect(accepts(maintenanceTaskStatusOutputSchema,await call('cbim_task_status',{taskId:'not-a-maintenance-task'}))).toEqual({state:'not_found'});
    expect(maintenanceTaskOutputSchema.safeParse({state:'not_found'}).success).toBe(false);
    expect(maintenanceTaskOutputSchema.safeParse({...completed,result:{state:'committed'}}).success).toBe(false);
    expect(maintenanceTaskOutputSchema.safeParse({...cancelled,state:'completed'}).success).toBe(false);
  }finally{await f.cleanup()}
});

it('原始JSON事实不接受undefined或非JSON类型；内置引用状态不补造可读取目标',()=>{
  const facts={extra:['',null,false,0,{invalidDefinition:true}],notAuthoritative:'diagnostic'};expect(jsonValueSchema.parse(facts)).toEqual(facts);
  for(const value of [undefined,()=>1,NaN,Infinity,BigInt(1)])expect(jsonValueSchema.safeParse(value).success).toBe(false);
  const ownKeys=JSON.parse('{"__proto__":{"diagnostic":"kept"},"constructor":"data","prototype":["fact"]}');
  expect(Object.hasOwn(jsonValueSchema.parse(ownKeys) as object,'__proto__')).toBe(true);accepts(jsonValueSchema,ownKeys);
  accepts(knowledgeContentOutputSchema,{available:false,reference:ownKeys});
  const cycle:Record<string,unknown>={};cycle.self=cycle;expect(jsonValueSchema.safeParse(cycle).success).toBe(false);
  const builtin={id:'fixture',kind:'standard',title:'Fixture',source:'docs/fixture.md',version:'a'.repeat(64),readOnly:true,text:'',contract:'read-only',references:[
    {reference:'#',anchor:'',status:'same_document'},
    {reference:'https://example.test',status:'external'},
    {reference:'missing.md',status:'unavailable'},
    {reference:'builtin:available#section',anchor:'section',status:'available',id:'available'},
  ]};accepts(builtinReadOutputSchema,builtin);
  expect(builtinReadOutputSchema.safeParse({...builtin,references:[{reference:'missing',status:'available'}]}).success).toBe(false);
  expect(builtinReadOutputSchema.safeParse({...builtin,references:[{reference:'missing',status:'external',id:'made-up'}]}).success).toBe(false);
});
