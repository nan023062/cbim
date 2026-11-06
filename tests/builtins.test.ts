import {it,expect} from 'vitest';
import {fixture} from './helpers';
import {connectWorkspace} from '../src/backend/main/integrations/mcp/discovery';
import {hash} from '../src/backend/core/foundation/serialization';

it('MCP 发现并读取内置治理流程、规范及服务解析引用，校验版本与身份',async()=>{
  const f=await fixture();let connection:Awaited<ReturnType<typeof connectWorkspace>>|undefined;
  try{
    await f.app.dispatch('add',{path:f.a});connection=await connectWorkspace(f.app.paths,f.a);const {client,identity}=connection;
    const tools=await client.listTools();const names=tools.tools.map(t=>t.name);expect(names).toHaveLength(26);expect(names.every(name=>name.startsWith('cbim_'))).toBe(true);expect(new Set(names).size).toBe(names.length);expect(names).toContain('cbim_builtin_catalog');expect(names).toContain('cbim_builtin_read');
    const call=async(name:string,args:any={})=>{const result=await client.callTool({name,arguments:{...identity,...args}});return {error:result.isError,value:JSON.parse((result.content as any)[0].text)}};
    for(const id of ['knowledge_query','business_execution','knowledge_governance','architecture_governance','create_agent_skill','create_workflow','core_check']){expect(tools.tools.map(t=>t.name)).toContain('cbim_skill_'+id);expect((await call('cbim_skill_'+id)).error).toBeFalsy()}
    const catalog=await call('cbim_builtin_catalog');expect(catalog.error).toBeFalsy();expect(catalog.value.items.length).toBe(21);
    for(const entry of catalog.value.items){const r=await call('cbim_builtin_read',{id:entry.id,expectedVersion:entry.version});expect(r.error).toBeFalsy();expect(hash(r.value.text)).toBe(entry.version);expect(r.value.readOnly).toBe(true);expect(r.value.source).not.toContain(f.temp)}
    const skill=await call('cbim_builtin_read',{id:catalog.value.entryId});expect(skill.value.text).toContain('cbim_knowledge_preview');expect(skill.value.references.every((r:any)=>r.status==='available')).toBe(true);
    const refs=await call('cbim_builtin_read',{id:'agent-spec'});expect(refs.value.references.some((r:any)=>r.id==='shared-skills-workflows')).toBe(true);
    expect((await call('cbim_builtin_read',{id:'knowledge-governance',expectedVersion:'old'})).value.code).toBe('BUILTIN_VERSION_CHANGED');
    for(const id of ['../../credentials.json','C:/secret','unknown'])expect((await call('cbim_builtin_read',{id})).value.code).toBe('BUILTIN_NOT_FOUND');
    expect((await call('cbim_builtin_catalog',{instanceId:'stale'})).value.code).toBe('STALE_INSTANCE');
    const snapshot=await call('cbim_knowledge_snapshot');expect(snapshot.value.files.some((x:any)=>x.path.includes('runtime/knowledge-governance'))).toBe(false);
  }finally{await connection?.client.close();await f.cleanup()}
});
