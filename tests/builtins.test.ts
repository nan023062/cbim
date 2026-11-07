import {it,expect} from 'vitest';
import {fixture,internalKnowledge} from './helpers';
import {hash} from '../src/backend/core/foundation/serialization';

it('内部知识工具发现并读取治理流程、规范及解析引用，校验版本与身份',async()=>{
  const f=await fixture();try{
    const e=await f.app.dispatch('add',{path:f.a}),{service,call}=internalKnowledge(f.app.workspace(e.id));
    const names=service.list().map(t=>t.name);expect(names).toHaveLength(28);
    expect(names).toContain('cbim_knowledge_tool_catalog');expect(names).toContain('cbim_knowledge_tool_describe');
    expect(names.every(name=>name.startsWith('cbim_'))).toBe(true);expect(new Set(names).size).toBe(names.length);
    expect(names).toContain('cbim_builtin_catalog');expect(names).toContain('cbim_builtin_read');
    for(const id of ['knowledge_query','business_execution','knowledge_governance','architecture_governance','create_agent_skill','create_workflow','core_check']){
      expect(names).toContain('cbim_skill_'+id);expect(await call('cbim_skill_'+id)).toBeTruthy();
    }
    const catalog=await call('cbim_builtin_catalog');expect(catalog.items.length).toBe(21);
    for(const entry of catalog.items){
      const r=await call('cbim_builtin_read',{id:entry.id,expectedVersion:entry.version});
      expect(hash(r.text)).toBe(entry.version);expect(r.readOnly).toBe(true);expect(r.source).not.toContain(f.temp);
    }
    const skill=await call('cbim_builtin_read',{id:catalog.entryId});expect(skill.text).toContain('cbim_knowledge_preview');
    expect(skill.references.every((r:any)=>r.status==='available')).toBe(true);
    const refs=await call('cbim_builtin_read',{id:'agent-spec'});expect(refs.references.some((r:any)=>r.id==='shared-skills-workflows')).toBe(true);
    await expect(call('cbim_builtin_read',{id:'knowledge-governance',expectedVersion:'old'})).rejects.toMatchObject({code:'BUILTIN_VERSION_CHANGED'});
    for(const id of ['../../credentials.json','C:/secret','unknown'])await expect(call('cbim_builtin_read',{id})).rejects.toMatchObject({code:'BUILTIN_NOT_FOUND'});
    await expect(call('cbim_builtin_catalog',{instanceId:'stale'})).rejects.toMatchObject({code:'STALE_INSTANCE'});
    const snapshot=await call('cbim_knowledge_snapshot');expect(snapshot.files.some((x:any)=>x.path.includes('runtime/knowledge-governance'))).toBe(false);
  }finally{await f.cleanup()}
});
