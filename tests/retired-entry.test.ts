import {it,expect} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fixture,request} from './helpers';
import {exists} from '../src/backend/core/foundation/files';
import {Application} from '../src/backend/main/application';
import {connectWorkspace} from '../src/backend/main/integrations/mcp/discovery';

it('初始化、应用启动与 MCP 重启不生成 entry，宿主指引直接包含 MCP 流程',async()=>{
  const f=await fixture();let app:Application|undefined;
  try{
    const e=await f.app.dispatch('add',{path:f.a});
    expect(await exists(path.join(f.a,'.cbim/entry.md'))).toBe(false);
    await f.app.shutdown();app=new Application(f.app.paths,path.resolve('design'));await app.init();
    await app.dispatch('restartMcp',{id:e.id});
    expect(await exists(path.join(f.a,'.cbim/entry.md'))).toBe(false);
    expect(await exists(path.join(app.paths.project(e.id),'entry-backups'))).toBe(false);
    for(const name of ['AGENTS.md','CLAUDE.md']){
      const text=await fs.readFile(path.join(f.a,name),'utf8');
      expect(text).toContain('cbim_workspace_identity');expect(text).toContain('cbim_skill_knowledge_governance');expect(text).not.toContain('entry.md');
    }
    expect(await fs.readFile(path.join(f.a,'.cbim/README.md'),'utf8')).not.toContain('entry.md');
  }finally{await app?.shutdown();await f.cleanup()}
});

it('遗留 entry 不再同步、备份、影响知识版本或通过 MCP 返回，原字节保留',async()=>{
  const f=await fixture();try{
    const e=await f.app.dispatch('add',{path:f.a}),original=await f.app.workspace(e.id).read();
    const target=path.join(f.a,'.cbim/entry.md'),bytes=Buffer.from('# obsolete-entry-private-marker');
    await fs.writeFile(target,bytes);
    // A stale backup location must no longer prevent the service from starting.
    await fs.writeFile(path.join(f.app.paths.project(e.id),'entry-backups'),'legacy blocked path');
    await f.app.dispatch('restartMcp',{id:e.id});
    expect(await fs.readFile(target)).toEqual(bytes);
    expect((await f.app.workspace(e.id).read()).revision).toBe(original.revision);
    const {client,identity}=await connectWorkspace(f.app.paths,f.a);
    try{
      for(const name of ['cbim_knowledge_snapshot','cbim_knowledge_search']){
        const response=await client.callTool({name,arguments:{...identity,...(name.endsWith('search')?{query:'obsolete-entry-private-marker'}:{})}});
        expect(response.isError).not.toBe(true);expect(JSON.stringify(response)).not.toContain('obsolete-entry-private-marker');
      }
    }finally{await client.close()}
    const ws=f.app.workspace(e.id),snap=await ws.read();
    await expect(ws.preview(request(snap,[{path:'.cbim/entry.md',text:'# recreated'}]))).rejects.toMatchObject({code:'TYPE'});
    await fs.unlink(target);await f.app.dispatch('restartMcp',{id:e.id});expect(await exists(target)).toBe(false);
  }finally{await f.cleanup()}
});
