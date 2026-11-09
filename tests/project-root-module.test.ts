import {expect,test} from 'vitest';
import {fixture,internalKnowledge} from './helpers';
import {seedTeam} from './team-fixture';
import {moduleGetOutputSchema,moduleRegistryOutputSchema} from '../src/backend/core/knowledge/tool-output-queries';

test('内置根始终可查询，不伪造正式模块文件或改写派生索引',async()=>{
  const f=await fixture();try{
    const entry=await f.app.dispatch('add',{path:f.a}),workspace=f.app.workspace(entry.id),tools=internalKnowledge(workspace);
    for(const seeded of [false,true]){
      if(seeded)await seedTeam(workspace);
      const before=await workspace.snapshot();
      const registry=moduleRegistryOutputSchema.parse(await tools.call('cbim_module_registry',{query:'no-matching-module'}));
      expect(registry.modules).toEqual([]);expect(registry.projectRoot).toMatchObject({id:'cbim:project',source:'builtin',children:before.validation!.tree.roots});
      const root=moduleGetOutputSchema.parse(await tools.call('cbim_module_get',{id:registry.projectRoot.id}));
      expect(root).toMatchObject({source:'builtin',id:'cbim:project',definition:{children:before.validation!.tree.roots},overview:{available:true},workflows:[]});
      expect(root).not.toHaveProperty('definitionFile');
      await expect(tools.call('cbim_module_get',{id:'cbim:not-real'})).rejects.toThrow();
      expect((await workspace.snapshot()).revision).toBe(before.revision);
      expect(before.files.some(file=>file.path.includes('cbim:project'))).toBe(false);
    }
  }finally{await f.cleanup()}
});
