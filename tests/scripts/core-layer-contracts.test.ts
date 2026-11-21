import {auditDependencies} from '../../scripts/check-dependencies.mjs';
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
it('Office only selects package engines through its verified dynamic loader',()=>{
  const report=auditDependencies();
  const edges=report.edges.filter(edge=>edge.from.startsWith('src/logic/projects/')&&edge.to.startsWith('src/engine-plugins/'));
  expect(edges).toHaveLength(4);
  expect(new Set(edges.map(edge=>edge.to))).toEqual(new Set(['pi','claude','codex','memory'].map(id=>'src/engine-plugins/'+id+'/package.ts')));
  for(const edge of edges){expect(edge.from).toBe('src/logic/projects/office-engine-loader.ts');expect(edge.kind).toBe('generated-dynamic/require');}
  expect(report.violations).toEqual([]);expect(report.logicalViolations).toEqual([]);
});
