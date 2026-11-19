import {Project} from '../../../../../src/framework/business';
import {expect,test} from 'vitest';
import {fixture} from '../../application/support/helpers';
import {internalKnowledge} from '../../tools/runtime/support/knowledge-tool-fixture';
import {seedTeam} from '../service/support/team-fixture';
import {moduleGetOutputSchema,moduleRegistryOutputSchema} from '../../../../../src/logic/knowledge/rules/tool-output-queries';

test('内置根始终可查询，不伪造正式模块文件或改写派生索引',async()=>{
  const f=await fixture();try{
    const entry=await f.app.Dispatch('add',{path:f.a}),workspace=f.app.Workspace(entry.id),tools=internalKnowledge(workspace);
    for(const seeded of [false,true]){
      if(seeded)await seedTeam(workspace);
      const before=await workspace.Snapshot();
      if(seeded){const nodes=Object.values(before.validation!.tree.nodes);expect(nodes.length).toBeGreaterThan(0);expect(nodes.every(n=>n.kind==='workspace')).toBe(true)}
      const registry=moduleRegistryOutputSchema.parse(await tools.call('cbim_workspace_registry',{query:'no-matching-module'}));
      expect(registry.modules).toEqual([]);expect(registry.projectRoot).toMatchObject({id:'cbim:project',source:'builtin',children:before.validation!.tree.roots});
      const root=moduleGetOutputSchema.parse(await tools.call('cbim_workspace_get',{id:registry.projectRoot.id}));
      expect(root).toMatchObject({source:'builtin',id:'cbim:project',definition:{children:before.validation!.tree.roots},overview:{available:true},workflows:[]});
      expect(root).not.toHaveProperty('definitionFile');
      await expect(tools.call('cbim_workspace_get',{id:'cbim:not-real'})).rejects.toThrow();
      expect((await workspace.Snapshot()).revision).toBe(before.revision);
      expect(before.files.some(file=>file.path.includes('cbim:project'))).toBe(false);
    }
  }finally{await f.cleanup()}
});

test('项目下每级工作区都独立承载业务',()=>{
  const source={location:'orders',scope:'billing'};
  const parent={kind:'workspace' as const,id:'orders',name:'订单',summary:'管理订单',sources:[source],children:['refunds']};
  const leaf={kind:'workspace' as const,id:'refunds',name:'退款',summary:'处理退款',sources:[],children:[]};
  const project=new Project({roots:['orders'],nodes:{orders:parent,refunds:leaf}});
  expect(project.kind).toBe('project');
  expect(project.children).toEqual(['orders']);
  expect(project.FindWorkspace('orders')).toEqual({...parent,kind:'workspace'});
  expect(project.FindWorkspace('refunds')).toEqual({...leaf,kind:'workspace'});
  expect(project.FindWorkspace(project.id)).toBeUndefined();
});
test('打开业务目录失败时释放 worktree，成功实例的并发关闭只释放一次', async () => {
  const project = new Project({ roots: ['art'], nodes: { art: { kind: 'workspace', id: 'art', name: 'Art', summary: '', sources: [], children: [] } } });
  let released = 0;
  const factory = {
    OpenWorktree: async (office: string, repository: string) => ({
      ResolveDirectory: async (relative: string) => {
        if (relative === 'missing') throw Error('missing');
        return [repository, office, relative].join('/');
      },
      Release: async () => { released++; }
    })
  };
  const context = { officeId: 'a', repositoryRoot: 'repo', relativeDirectory: 'Art' };
  const a = await project.OpenWorkspace('art', context, factory);
  const b = await project.OpenWorkspace('art', { ...context, officeId: 'b' }, factory);
  expect(a.directory).toBe('repo/a/Art');
  expect(b.directory).toBe('repo/b/Art');
  expect(a.instanceId).not.toBe(b.instanceId);
  await expect(project.OpenWorkspace('art', { ...context, relativeDirectory: 'missing' }, factory)).rejects.toThrow('missing');
  expect(released).toBe(1);
  await Promise.all([a.Close(), a.Close(), b.Close()]);
  expect(released).toBe(3);
});
