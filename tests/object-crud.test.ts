import {it,expect} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fixture,summary,moduleFiles} from './helpers';
import {connectWorkspace} from '../src/backend/main/integrations/mcp/discovery';

it('真实 MCP 对象 CRUD、父子模块、Skill 继承与仅本模块 Workflow，重复提交幂等',async()=>{
  const f=await fixture();let c:Awaited<ReturnType<typeof connectWorkspace>>|undefined;
  try{
    const e=await f.app.dispatch('add',{path:f.a});const w=f.app.workspace(e.id);w.writable=true;c=await connectWorkspace(f.app.paths,f.a,true);
    const call=async(name:string,args:any={})=>{const r=await c!.client.callTool({name,arguments:{...c!.identity,...args}});const v=JSON.parse((r.content as any)[0].text);if(r.isError)throw Object.assign(Error(v.message),v);return v};
    const mutate=async(operations:any[])=>{const s=await call('cbim_knowledge_snapshot');const p=await call('cbim_object_preview',{revision:s.revision,operations});expect(p.validation.issues.filter((i:any)=>i.severity==='error')).toEqual([]);const r=await call('cbim_object_commit',{planId:p.planId});expect((await call('cbim_object_commit',{planId:p.planId})).revision).toBe(r.revision);return p.objects};
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
    expect((await call('cbim_module_registry')).modules).toEqual([]);expect((await call('cbim_people_list')).people).toEqual([]);
    await expect(call('cbim_agent_get',{id:agent})).rejects.toMatchObject({code:'OBJECT_NOT_FOUND'});
  }finally{await c?.client.close();await f.cleanup()}
});

it('对象事务拒绝越界、旧版本、未授权提交和继承冲突，校验失败不落盘',async()=>{
  const f=await fixture();let c:Awaited<ReturnType<typeof connectWorkspace>>|undefined;
  try{
    const e=await f.app.dispatch('add',{path:f.a});c=await connectWorkspace(f.app.paths,f.a,true);
    const call=async(name:string,args:any={})=>{const r=await c!.client.callTool({name,arguments:{...c!.identity,...args}});return {error:r.isError,value:JSON.parse((r.content as any)[0].text)}};
    const s=(await call('cbim_knowledge_snapshot')).value;
    const op={kind:'agent',action:'create',parentId:'.cbim/team',slug:'dev',data:{name:'Dev',summary,capabilities:['开发']},body:'# Principles'};
    expect((await call('cbim_object_preview',{revision:s.revision,operations:[{...op,slug:'../escape'}]})).value.code).toBe('OBJECT_ID');
    const p=(await call('cbim_object_preview',{revision:s.revision,operations:[op]})).value;
    expect((await call('cbim_object_commit',{planId:p.planId})).value.code).toBe('FORBIDDEN');
    f.app.workspace(e.id).writable=true;await fs.writeFile(path.join(f.a,'.cbim/README.md'),'# External');
    expect((await call('cbim_object_commit',{planId:p.planId})).value.code).toBe('CONFLICT');
    const fresh=(await call('cbim_knowledge_snapshot')).value;
    const invalid=(await call('cbim_object_preview',{revision:fresh.revision,operations:[{...op,data:{...op.data,summary:'too short'}}]})).value;expect(invalid.validation.structural).toBe(false);
    expect((await call('cbim_object_commit',{planId:invalid.planId})).value.code).toBe('VALIDATION');await expect(fs.access(path.join(f.a,'.cbim/team/dev/agent.json'))).rejects.toThrow();
    expect((await call('cbim_module_get',{id:'../../outside'})).value.code).toBe('OBJECT_NOT_FOUND');
  }finally{await c?.client.close();await f.cleanup()}
});

it('刷新接口仅更新派生索引，错误保留问题与原索引，查询注册表不偷偷写入',async()=>{
  const f=await fixture();let c:Awaited<ReturnType<typeof connectWorkspace>>|undefined;
  try{
    await f.app.dispatch('add',{path:f.a});c=await connectWorkspace(f.app.paths,f.a);
    const call=async(name:string,args:any={})=>{const r=await c!.client.callTool({name,arguments:{...c!.identity,...args}});expect(r.isError).toBeFalsy();return JSON.parse((r.content as any)[0].text)};
    const index=path.join(f.a,'.cbim/workspace/registry.json'),before=await fs.readFile(index,'utf8');
    for(const file of moduleFiles('game')){await fs.mkdir(path.dirname(path.join(f.a,file.path)),{recursive:true});await fs.writeFile(path.join(f.a,file.path),file.text)}
    expect((await call('cbim_module_registry')).modules).toHaveLength(1);expect(await fs.readFile(index,'utf8')).toBe(before);
    await fs.writeFile(path.join(f.a,'.cbim/README.md'),'[bad](../../../missing.md)');expect((await call('cbim_knowledge_refresh')).state).toBe('invalid');expect(await fs.readFile(index,'utf8')).toBe(before);
    await fs.writeFile(path.join(f.a,'.cbim/README.md'),'# Valid');expect((await call('cbim_knowledge_refresh')).state).toBe('refreshed');expect(JSON.parse(await fs.readFile(index,'utf8')).modules).toHaveLength(1);
  }finally{await c?.client.close();await f.cleanup()}
});
