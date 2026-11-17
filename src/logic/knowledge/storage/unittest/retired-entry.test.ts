// logic/knowledge/storage: module-owned integration coverage; keep the original scenario and cleanup semantics.
import {it,expect} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fixture} from '../../../application/unittest/support/helpers';
import {request} from '../../rules/unittest/data/knowledge';
import {internalKnowledge} from '../../../tools/runtime/unittest/support/knowledge-tool-fixture';
import {exists} from '../../../../core/platform/node/files/index';
import {Application} from '../../../../bridge/server/application';

it('遗留 entry 不再同步、备份、影响知识版本或通过内部知识工具返回，原字节保留',async()=>{
  const f=await fixture();try{
    const e=await f.app.Dispatch('add',{path:f.a}),original=await f.app.Workspace(e.id).Read();
    const target=path.join(f.a,'.cbim/entry.md'),bytes=Buffer.from('# obsolete-entry-private-marker');
    await fs.writeFile(target,bytes);
    // A stale backup location must no longer prevent the service from starting.
    await fs.writeFile(path.join(f.app.paths.Project(e.id),'entry-backups'),'legacy blocked path');
    await f.app.Open(e.id,true);
    expect(await fs.readFile(target)).toEqual(bytes);
    expect((await f.app.Workspace(e.id).Read()).revision).toBe(original.revision);
    const {call}=internalKnowledge(f.app.Workspace(e.id));
    for(const name of ['cbim_knowledge_snapshot','cbim_knowledge_search']){
      const response=await call(name,name.endsWith('search')?{query:'obsolete-entry-private-marker'}:{});
      expect(JSON.stringify(response)).not.toContain('obsolete-entry-private-marker');
    }
    const ws=f.app.Workspace(e.id),snap=await ws.Read();
    await expect(ws.Preview(request(snap,[{path:'.cbim/entry.md',text:'# recreated'}]))).rejects.toMatchObject({code:'TYPE'});
    await fs.unlink(target);await f.app.Open(e.id,true);expect(await exists(target)).toBe(false);
  }finally{await f.cleanup()}
});
