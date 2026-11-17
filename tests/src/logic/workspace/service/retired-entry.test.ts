// logic/workspace/service: module-owned integration coverage; keep the original scenario and cleanup semantics.
import {it,expect} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fixture} from '../../application/support/helpers';
import {request} from '../../knowledge/rules/data/knowledge';
import {internalKnowledge} from '../../tools/runtime/support/knowledge-tool-fixture';
import {exists} from '../../../../../src/core/platform/node/files/index';
import {Application} from '../../../../../src/bridge/server/application';

it('初始化、应用启动与工作区重启不生成废弃入口或宿主指引',async()=>{
  const f=await fixture();let app:Application|undefined;
  try{
    const e=await f.app.Dispatch('add',{path:f.a});
    expect(await exists(path.join(f.a,'.cbim/entry.md'))).toBe(false);
    await f.app.Shutdown();app=new Application(f.app.paths);await app.Init();
    await app.Open(e.id,true);
    expect(await exists(path.join(f.a,'.cbim/entry.md'))).toBe(false);
    expect(await exists(path.join(app.paths.Project(e.id),'entry-backups'))).toBe(false);
    for(const name of ['AGENTS.md','CLAUDE.md']){
      expect(await exists(path.join(f.a,name))).toBe(false);
    }
    expect(await fs.readFile(path.join(f.a,'.cbim/README.md'),'utf8')).not.toContain('entry.md');
  }finally{await app?.Shutdown();await f.cleanup()}
});
