import {expect,test} from 'vitest';
import type {ResourceDefinition,ResourceKind} from '../src/bridge/contracts/resources';
import {applicableResourceKind,creatableResourceKinds} from '../src/view/resources/resource-application';
const item=(kind:ResourceKind,content:string):ResourceDefinition=>({id:'r',kind,content,name:'资源',summary:'',updatedAt:''});
test('resource application is limited to matching static package formats and complete architectures',()=>{
  for(const kind of ['team','agent','skill','architecture'] as const)expect(applicableResourceKind(item(kind,JSON.stringify({format:'cbim-workspace-package',kind})))).toBe(kind);
  for(const kind of ['connector','module','workflow'] as const)expect(applicableResourceKind(item(kind,JSON.stringify({format:'cbim-workspace-package',kind})))).toBeUndefined();
  expect(applicableResourceKind(item('agent','legacy markdown'))).toBeUndefined();
  expect(applicableResourceKind(item('agent','null'))).toBeUndefined();
  expect(applicableResourceKind(item('agent',JSON.stringify({format:'cbim-workspace-package',kind:'team'})))).toBeUndefined();
});
test('new templates only create complete architecture while talent retains team agent and Skill',()=>{
  expect(creatableResourceKinds('templates')).toEqual(['architecture']);
  expect(creatableResourceKinds('talent')).toEqual(['team','agent','skill']);
  expect(creatableResourceKinds('connectors')).toEqual(['connector']);
});
