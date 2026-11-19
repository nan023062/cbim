import {it,expect} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

it('领域规则不反向导入服务、具体引擎、Bridge、View 或 Electron，包括类型依赖',()=>{
  const walk=(directory:string):string[]=>fs.readdirSync(directory,{withFileTypes:true}).flatMap(e=>e.isDirectory()?e.name==='unittest'?[]:walk(path.join(directory,e.name)):[path.join(directory,e.name)]);
  const files=walk('src/logic').filter(p=>p.endsWith('.ts')&&(/\/logic\/[^/]+\/(rules|ports)(\/|$)/.test(path.resolve(p).replaceAll('\\','/'))));
  expect(files.length).toBeGreaterThan(0);
  for(const file of files){
    const source=fs.readFileSync(file,'utf8');
    for(const match of source.matchAll(/(?:from\s*|import\s*)['"]([^'"]+)['"]/g)){
      const target=match[1].startsWith('.')?path.resolve(path.dirname(file),match[1]).replaceAll('\\','/'):match[1];
      expect(target,`${file}: ${match[1]}`).not.toMatch(/(?:\/src\/(?:bridge|view)\/)|(?:\/src\/logic\/[^/]+\/(?:service|engines|storage|settings|platform|runtime|assembly)\/)|^electron(?:\/|$)/);
    }
  }
});
it('编排仅在 execution/assembly 选择具体引擎，不直接取得应用服务或平台',()=>{
  const root=path.resolve('src').replaceAll('\\','/');
  const walk=(directory:string):string[]=>fs.readdirSync(directory,{withFileTypes:true}).flatMap(e=>e.isDirectory()?e.name==='unittest'?[]:walk(path.join(directory,e.name)):[path.join(directory,e.name)]);
  const orchestration=(p:string)=>/\/logic\/(execution\/(admission|assembly|context)|[^/]+\/(runtime|monitoring))\//.test(p);
  const files=walk('src/logic').filter(p=>p.endsWith('.ts')&&orchestration(path.resolve(p).replaceAll('\\','/')));
  expect(files.length).toBeGreaterThan(0);
  for(const file of files){
    const source=fs.readFileSync(file,'utf8');
    // 目录整理后的契约只允许装配点选择具体引擎，不给普通调度模块开放此依赖。
    const assembly=path.resolve(file).replaceAll('\\','/').startsWith(root+'/logic/execution/assembly/');
    for(const match of source.matchAll(/(?:from\s*|import\s*)['"]([^'"]+)['"]/g)){
      expect(match[1]).not.toMatch(/^electron(?:\/|$)/);
      if(!match[1].startsWith('.'))continue;
      const target=path.resolve(path.dirname(file),match[1]).replaceAll('\\','/');
      // engines 的便携公开入口仅含静态描述与选型规则；具体适配器仍限制在 execution/assembly。
      const pure=['core/utility','core/io','core/io/json','core/io/serialization','logic/models','logic/engines','logic/web','logic/feedback'].some(p=>target===root+'/'+p);
      // 公共父子引用是无运行时依赖的细粒度数据契约；只有装配可引用 Agent 对象与问答协调。
      const agentBoundary=['framework/office/call','framework/cability/agent/questions','framework/cability/agent/identity'].some(p=>target===root+'/'+p)||assembly&&['framework/cability/organization','framework/office/exchange'].some(p=>target===root+'/'+p);
      const frameworkAccess=target===root+'/framework/office'&&path.basename(file)==='agent-manager.ts'||assembly&&['framework/connectors','framework/kernel','framework/office','framework/cability/agent'].some(p=>target===root+'/'+p);
      expect(frameworkAccess||pure||agentBoundary||/\/logic\/[^/]+\/(rules|ports)(\/|$)/.test(target)||orchestration(target)||(assembly&&target.startsWith(root+'/engine-plugins/')),`${file}: ${match[1]}`).toBe(true);
    }
  }
});
