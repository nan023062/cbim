import {randomUUID} from 'node:crypto';
import {it,expect} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import Ajv from 'ajv';
import {objectOperation} from '../src/backend/core/knowledge/object-crud';
import {fixture} from './helpers';
import {summary,moduleFiles} from './data/knowledge';
import {internalKnowledge} from './knowledge-tool-fixture';

it('实际发现的对象 Schema 按 kind 限制字段，和运行时接受的字段一致',async()=>{
  const f=await fixture();try{
    const e=await f.app.dispatch('add',{path:f.a}),w=f.app.workspace(e.id),{call,identity}=internalKnowledge(w),snapshot=await w.snapshot();
    const described=await call('cbim_knowledge_tool_describe',{name:'cbim_object_preview'});
    expect(described.tool.version).toBe(2);
    const schemaText=JSON.stringify(described.tool.inputSchema);
    for(const constraint of ['100–250','cbim:project','保留名称','子模块和 source 节点','CbimDirectContent','前序创建'])expect(schemaText).toContain(constraint);
    const validate=new Ajv({strict:false}).compile(described.tool.inputSchema);
    for(const [kind,data,valid] of [
      ['module',{name:'中国象棋'},false],['agent',{purpose:'写代码'},false],
      ['module',{summary},true],['agent',{name:'开发',summary,capabilities:['实现']},true],
      ['skill',{name:'检查',purpose:'验证'},true],['workflow',{name:'开发流程'},true],
    ] as const){
      const operation={kind,action:'create',parentId:kind==='module'?'.cbim/workspace':'.cbim/team',slug:'chess',data,body:kind==='module'?moduleFiles('chess')[1].text:'# 业务正文'};
      expect(objectOperation.safeParse(operation).success).toBe(valid);
      const input={...identity,revision:snapshot.revision,operations:[operation]};
      expect(validate(input),JSON.stringify(validate.errors)).toBe(valid);
      if(!valid)await expect(call('cbim_object_preview',input)).rejects.toThrow();
      else if(kind==='agent'||kind==='module'){
        const preview=await call('cbim_object_preview',input);expect(preview.validation.structural).toBe(true);
        if(kind==='module')expect(JSON.parse(preview.changes.find((c:any)=>c.path.endsWith('/module.json')).text).name).toBe('chess');
      }
    }
    expect((await w.snapshot()).revision).toBe(snapshot.revision);
  }finally{await f.cleanup()}
});

it('同一真实预览按序创建父、子及其 Workflow，完整校验后一次提交',async()=>{
 const f=await fixture();try{
  const entry=await f.app.dispatch('add',{path:f.a}),{call}=internalKnowledge(f.app.workspace(entry.id)),snapshot=await call('cbim_knowledge_snapshot');
  const parent='.cbim/workspace/game',child=parent+'/child';
  const preview=await call('cbim_object_preview',{revision:snapshot.revision,operations:[
   {kind:'module',action:'create',parentId:'.cbim/workspace',slug:'game',data:{summary},body:moduleFiles('game')[1].text},
   {kind:'module',action:'create',parentId:parent,slug:'child',data:{summary},body:moduleFiles('game/child')[1].text},
   {kind:'workflow',action:'create',parentId:child,slug:'build',data:{name:'构建'},body:'# 构建\n实际验证。'},
  ]});
  expect(preview.validation.issues.filter((v:any)=>v.severity==='error')).toEqual([]);
  await expect(fs.access(path.join(f.a,parent))).rejects.toThrow();
  expect((await call('cbim_object_commit',{planId:preview.planId},true)).state).toBe('committed');
  expect((await call('cbim_module_get',{id:parent})).definition.children).toEqual([child]);
  expect((await call('cbim_module_get',{id:child})).workflows[0].id).toBe(child+'/workflows/build');
 }finally{await f.cleanup()}
});

it('内部知识服务真实对象 CRUD、父子模块、Skill 继承与仅本模块 Workflow，重复提交幂等',async()=>{
  const f=await fixture();
  try{
    const e=await f.app.dispatch('add',{path:f.a}),{call}=internalKnowledge(f.app.workspace(e.id));
    const mutate=async(operations:any[])=>{const s=await call('cbim_knowledge_snapshot');const p=await call('cbim_object_preview',{revision:s.revision,operations});expect(p.validation.issues.filter((i:any)=>i.severity==='error')).toEqual([]);const r=await call('cbim_object_commit',{planId:p.planId},true);expect((await call('cbim_object_commit',{planId:p.planId},true)).revision).toBe(r.revision);return p.objects};
    const [agent]=await mutate([{kind:'agent',action:'create',parentId:(await call('cbim_agent_registry')).teamRootId,slug:'developer',data:{name:'开发者',summary,capabilities:['开发']},body:'# 工作原则\n验证实际成果。'}]);
    const [shared,own]=await mutate([{kind:'skill',action:'create',parentId:'.cbim/team',slug:'review',data:{name:'review',purpose:'检查'},body:'# Review'},{kind:'skill',action:'create',parentId:agent,slug:'coding',data:{name:'coding',purpose:'开发'},body:'# Coding'}]);
    let detail=await call('cbim_agent_get',{id:agent});expect(detail.skills.map((x:any)=>x.id)).toEqual([own,shared]);expect(detail.skills[1].inherited).toBe(true);expect(detail.skills.every((x:any)=>x.content.available)).toBe(true);
    const [module]=await mutate([{kind:'module',action:'create',parentId:(await call('cbim_module_registry')).workspaceRootId,slug:'game',data:{summary},body:moduleFiles('game')[1].text}]);
    const [child,flow]=await mutate([{kind:'module',action:'create',parentId:module,slug:'child',data:{summary},body:moduleFiles('game/child')[1].text},{kind:'workflow',action:'create',parentId:module,slug:'build',data:{name:'构建'},body:'# 构建\n验证。'}]);
    expect((await call('cbim_module_get',{id:module})).definition.children).toEqual([child]);expect((await call('cbim_module_get',{id:module})).workflows[0].id).toBe(flow);expect((await call('cbim_module_get',{id:child})).workflows).toEqual([]);
    await mutate([{kind:'agent',action:'update',id:agent,data:{name:'客户端开发者'},body:'# 新原则'},{kind:'skill',action:'update',id:own,data:{purpose:'实现与验证'},body:'# Updated'},{kind:'workflow',action:'update',id:flow,data:{name:'构建验证'},body:'# Build'}]);
    detail=await call('cbim_agent_get',{id:agent});expect(detail.definition.name).toBe('客户端开发者');expect(detail.principles.text).toBe('# 新原则');expect(detail.skills[0].purpose).toBe('实现与验证');
    const rev=(await call('cbim_knowledge_snapshot')).revision;await expect(call('cbim_object_preview',{revision:rev,operations:[{kind:'module',action:'delete',id:module}]})).rejects.toMatchObject({code:'HAS_CHILDREN'});
    await mutate([{kind:'module',action:'delete',id:child},{kind:'workflow',action:'delete',id:flow},{kind:'skill',action:'delete',id:own}]);
    expect((await call('cbim_module_get',{id:module})).definition.children).toEqual([]);
    await mutate([{kind:'agent',action:'delete',id:agent},{kind:'module',action:'delete',id:module},{kind:'skill',action:'delete',id:shared}]);
    expect((await call('cbim_module_registry')).modules).toEqual([]);await expect(call('cbim_people_list')).rejects.toThrow();
    await expect(call('cbim_agent_get',{id:agent})).rejects.toMatchObject({code:'OBJECT_NOT_FOUND'});
  }finally{await f.cleanup()}
});

it('刷新接口仅更新派生索引，错误保留问题与原索引，查询注册表不偷偷写入',async()=>{
  const f=await fixture();
  try{
    const e=await f.app.dispatch('add',{path:f.a}),{call}=internalKnowledge(f.app.workspace(e.id));
    const index=path.join(f.a,'.cbim/workspace/registry.json'),before=await fs.readFile(index,'utf8');
    for(const file of moduleFiles('game')){await fs.mkdir(path.dirname(path.join(f.a,file.path)),{recursive:true});await fs.writeFile(path.join(f.a,file.path),file.text)}
    expect((await call('cbim_module_registry')).modules).toHaveLength(1);expect(await fs.readFile(index,'utf8')).toBe(before);
    await fs.writeFile(path.join(f.a,'.cbim/README.md'),'[bad](../../../missing.md)');expect((await call('cbim_knowledge_refresh',{revision:(await call('cbim_knowledge_snapshot')).revision,requestId:randomUUID()},true)).state).toBe('invalid');expect(await fs.readFile(index,'utf8')).toBe(before);
    await fs.writeFile(path.join(f.a,'.cbim/README.md'),'# Valid');expect((await call('cbim_knowledge_refresh',{revision:(await call('cbim_knowledge_snapshot')).revision,requestId:randomUUID()},true)).state).toBe('refreshed');expect(JSON.parse(await fs.readFile(index,'utf8')).modules).toHaveLength(1);
  }finally{await f.cleanup()}
});

it('对象事务拒绝越界、旧版本和未授权提交，校验失败不落盘',async()=>{
  const f=await fixture();try{
    const e=await f.app.dispatch('add',{path:f.a}),{call}=internalKnowledge(f.app.workspace(e.id));
    const s=await call('cbim_knowledge_snapshot');
    const op={kind:'agent',action:'create',parentId:'.cbim/team',slug:'dev',data:{name:'Dev',summary,capabilities:['开发']},body:'# Principles'};
    await expect(call('cbim_object_preview',{revision:s.revision,operations:[{...op,slug:'../escape'}]})).rejects.toMatchObject({code:'OBJECT_ID'});
    const p=await call('cbim_object_preview',{revision:s.revision,operations:[op]});
    await expect(call('cbim_object_commit',{planId:p.planId})).rejects.toMatchObject({code:'FORBIDDEN'});
    await fs.writeFile(path.join(f.a,'.cbim/README.md'),'# External');
    await expect(call('cbim_object_commit',{planId:p.planId},true)).rejects.toMatchObject({code:'CONFLICT'});
    const fresh=await call('cbim_knowledge_snapshot');
    const invalid=await call('cbim_object_preview',{revision:fresh.revision,operations:[{...op,data:{...op.data,summary:'too short'}}]});expect(invalid.validation.structural).toBe(false);
    await expect(call('cbim_object_commit',{planId:invalid.planId},true)).rejects.toMatchObject({code:'VALIDATION'});
    await expect(fs.access(path.join(f.a,'.cbim/team/dev/agent.json'))).rejects.toThrow();
    await expect(call('cbim_module_get',{id:'../../outside'})).rejects.toMatchObject({code:'OBJECT_NOT_FOUND'});
  }finally{await f.cleanup()}
});
