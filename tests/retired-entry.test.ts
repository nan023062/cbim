import {it,expect} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './helpers';
import {request} from './data/knowledge';
import {internalKnowledge} from './knowledge-tool-fixture';
import {exists} from '../src/backend/core/foundation/files';
import {Application} from '../src/backend/main/assembly/application';

it('初始化、应用启动与工作区重启不生成废弃入口或宿主指引',async()=>{
  const f=await fixture();let app:Application|undefined;
  try{
    const e=await f.app.dispatch('add',{path:f.a});
    expect(await exists(path.join(f.a,'.cbim/entry.md'))).toBe(false);
    await f.app.shutdown();app=new Application(f.app.paths,path.resolve('design'));await app.init();
    await app.open(e.id,true);
    expect(await exists(path.join(f.a,'.cbim/entry.md'))).toBe(false);
    expect(await exists(path.join(app.paths.project(e.id),'entry-backups'))).toBe(false);
    for(const name of ['AGENTS.md','CLAUDE.md']){
      expect(await exists(path.join(f.a,name))).toBe(false);
    }
    expect(await fs.readFile(path.join(f.a,'.cbim/README.md'),'utf8')).not.toContain('entry.md');
  }finally{await app?.shutdown();await f.cleanup()}
});

it('遗留 entry 不再同步、备份、影响知识版本或通过内部知识工具返回，原字节保留',async()=>{
  const f=await fixture();try{
    const e=await f.app.dispatch('add',{path:f.a}),original=await f.app.workspace(e.id).read();
    const target=path.join(f.a,'.cbim/entry.md'),bytes=Buffer.from('# obsolete-entry-private-marker');
    await fs.writeFile(target,bytes);
    // A stale backup location must no longer prevent the service from starting.
    await fs.writeFile(path.join(f.app.paths.project(e.id),'entry-backups'),'legacy blocked path');
    await f.app.open(e.id,true);
    expect(await fs.readFile(target)).toEqual(bytes);
    expect((await f.app.workspace(e.id).read()).revision).toBe(original.revision);
    const {call}=internalKnowledge(f.app.workspace(e.id));
    for(const name of ['cbim_knowledge_snapshot','cbim_knowledge_search']){
      const response=await call(name,name.endsWith('search')?{query:'obsolete-entry-private-marker'}:{});
      expect(JSON.stringify(response)).not.toContain('obsolete-entry-private-marker');
    }
    const ws=f.app.workspace(e.id),snap=await ws.read();
    await expect(ws.preview(request(snap,[{path:'.cbim/entry.md',text:'# recreated'}]))).rejects.toMatchObject({code:'TYPE'});
    await fs.unlink(target);await f.app.open(e.id,true);expect(await exists(target)).toBe(false);
  }finally{await f.cleanup()}
});
