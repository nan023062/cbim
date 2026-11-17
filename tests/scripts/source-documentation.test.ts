import {it,expect} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root=path.resolve('src');
const walk=(p:string):string[]=>fs.readdirSync(p,{withFileTypes:true}).flatMap(e=>e.isDirectory()?e.name==='unittest'?[]:walk(path.join(p,e.name)):/\.tsx?$/.test(e.name)?[path.join(p,e.name)]:[]);
const files=walk(root);

it('每个维护中的源码目录有架构文档，源代码有定位与原因说明',()=>{
  const directories=new Set<string>();
  for(const file of files){
    let directory=path.dirname(file);while(directory.startsWith(root)){directories.add(directory);if(directory===root)break;directory=path.dirname(directory)}
    const header=fs.readFileSync(file,'utf8').slice(0,1600);
    expect(header,file).toContain('作用定位');expect(header,file).toContain('设计原因');
  }
  for(const directory of directories)expect(fs.existsSync(path.join(directory,'ARCHITECTURE.md')),directory).toBe(true);
});
