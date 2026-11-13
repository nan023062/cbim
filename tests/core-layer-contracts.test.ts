import {it,expect} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

it('core 不反向导入具体引擎、调度、main、renderer 或 Electron，包括类型依赖',()=>{
  const walk=(directory:string):string[]=>fs.readdirSync(directory,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(directory,e.name)):[path.join(directory,e.name)]);
  for(const file of walk('src/backend/core').filter(p=>p.endsWith('.ts'))){
    const source=fs.readFileSync(file,'utf8');
    for(const match of source.matchAll(/(?:from\s*|import\s*)['"]([^'"]+)['"]/g)){
      const target=match[1].startsWith('.')?path.resolve(path.dirname(file),match[1]).replaceAll('\\','/'):match[1];
      expect(target,`${file}: ${match[1]}`).not.toMatch(/(?:\/src\/(?:backend\/(?:main|scheduler-engine|engines)|frontend|bridge)\/)|^electron(?:\/|$)/);
    }
  }
});
it('调度仅在 assembly 依赖具体引擎，其余项目内依赖限于自身与 core',()=>{
  const root=path.resolve('src/backend').replaceAll('\\','/');
  const walk=(directory:string):string[]=>fs.readdirSync(directory,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(directory,e.name)):[path.join(directory,e.name)]);
  const files=walk('src/backend/scheduler-engine').filter(p=>p.endsWith('.ts'));
  expect(files.length).toBeGreaterThan(0);
  for(const file of files){
    const source=fs.readFileSync(file,'utf8');
    // 目录整理后的契约只允许装配点选择具体引擎，不给普通调度模块开放此依赖。
    const assembly=path.resolve(file).replaceAll('\\','/').startsWith(root+'/scheduler-engine/assembly/');
    for(const match of source.matchAll(/(?:from\s*|import\s*)['"]([^'"]+)['"]/g)){
      expect(match[1]).not.toMatch(/^electron(?:\/|$)/);
      if(!match[1].startsWith('.'))continue;
      const target=path.resolve(path.dirname(file),match[1]).replaceAll('\\','/');
      expect(target.startsWith(root+'/core/')||target.startsWith(root+'/scheduler-engine/')||(assembly&&target.startsWith(root+'/engines/')),`${file}: ${match[1]}`).toBe(true);
    }
  }
});