import {it,expect} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {ConnectorRegistry} from '../src/backend/core/connectors/registry';
import {Team,BusinessWorkspace,content} from '../src/backend/core/knowledge/read-models';
import {domainSnapshot} from './data/domain-snapshot';

it('核心领域在固定快照上解析团队 Skill 和本模块 Workflow，无需 main 实例',async()=>{
  const seed=domainSnapshot(),before=structuredClone(seed.snapshot);
  const hr=new Team(seed.snapshot),business=new BusinessWorkspace(seed.snapshot);
  const agent=await hr.agent(seed.agentId);
  expect(agent.skills.map(s=>s.id)).toEqual([seed.own,seed.shared]);
  expect(agent.skills.map(s=>s.inherited)).toEqual([false,true]);
  expect((await business.module(seed.moduleId)).workflows[0].id).toBe(seed.workflowId);
  expect((await business.module(seed.child)).workflows).toEqual([]);
  expect(seed.snapshot).toEqual(before);
});
it('固定快照缺对象或正文时明确报告，不从磁盘补造资料',async()=>{
  const {snapshot,agentId}=domainSnapshot();
  await expect(new Team(snapshot).agent('.cbim/team/missing')).rejects.toMatchObject({code:'OBJECT_NOT_FOUND'});
  await expect(new BusinessWorkspace(snapshot).module('.cbim/workspace/missing')).rejects.toMatchObject({code:'OBJECT_NOT_FOUND'});
  expect(content(snapshot,agentId,'missing.md')).toMatchObject({available:false});
  expect(content(snapshot,agentId,'../../../secret.md')).toMatchObject({available:false,reason:'引用越界'});
});
it('链接器封装查询和唯一身份规则，不启动外部工具',()=>{
  const connector={id:'.cbim/connectors/docs',name:'文档桥',summary:'团队文档',plugin:{ghost_id:'docs',namespace:null}};
  const registry=new ConnectorRegistry([connector,{...connector,id:'.cbim/connectors/other'}]);
  expect(registry.get(connector.id)).toEqual(connector);expect(registry.list('文档')).toHaveLength(2);
  expect(registry.duplicates()).toEqual(['.cbim/connectors/other']);
});
it('core 不反向导入调度引擎、main、renderer 或 Electron，包括类型依赖',()=>{
  const walk=(directory:string):string[]=>fs.readdirSync(directory,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(directory,e.name)):[path.join(directory,e.name)]);
  for(const file of walk('src/backend/core').filter(p=>p.endsWith('.ts'))){
    const source=fs.readFileSync(file,'utf8');
    for(const match of source.matchAll(/(?:from\s*|import\s*)['"]([^'"]+)['"]/g)){
      const target=match[1].startsWith('.')?path.resolve(path.dirname(file),match[1]).replaceAll('\\','/'):match[1];
      expect(target,`${file}: ${match[1]}`).not.toMatch(/(?:\/src\/(?:backend\/(?:main|scheduler-engine)|frontend|bridge)\/)|^electron(?:\/|$)/);
    }
  }
});
it('调度引擎的项目内依赖仅限自身与 core',()=>{
  const root=path.resolve('src/backend').replaceAll('\\','/');
  const walk=(directory:string):string[]=>fs.readdirSync(directory,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(directory,e.name)):[path.join(directory,e.name)]);
  const files=walk('src/backend/scheduler-engine').filter(p=>p.endsWith('.ts'));
  expect(files.length).toBeGreaterThan(0);
  for(const file of files){
    const source=fs.readFileSync(file,'utf8');
    for(const match of source.matchAll(/(?:from\s*|import\s*)['"]([^'"]+)['"]/g)){
      expect(match[1]).not.toMatch(/^electron(?:\/|$)/);
      if(!match[1].startsWith('.'))continue;
      const target=path.resolve(path.dirname(file),match[1]).replaceAll('\\','/');
      expect(target.startsWith(root+'/core/')||target.startsWith(root+'/scheduler-engine/'),`${file}: ${match[1]}`).toBe(true);
    }
  }
});
