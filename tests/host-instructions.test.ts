import {it,expect} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './helpers';
import {exists} from '../src/backend/core/foundation/files';
import {buildHostInstructions} from '../src/backend/main/integrations/hosts/host-instructions';
import {builtinSkills} from '../src/backend/core/knowledge/builtins';

it('removes the complete unmarked legacy workflow section shown below the managed block',async()=>{
  const f=await fixture();try{
    const originals=new Map<string,string>();
    for(const [name,host,eol] of [['CLAUDE.md','Claude','\n'],['AGENTS.md','Codex','\r\n'],['AGENTS.override.md','Agent','\n']]){
      const legacy=['## '+host+' 工作流入口','','完整读取并立即执行 [CBIM 启动入口](.cbim/entry.md)。','后续工作流加载与执行均由该入口路由，不在本文件展开流程规则。','入口缺失或无法读取时，报告具体路径并停止工作流启动；不得自行回退到其他工作流。',''].join(eol);
      const original=buildHostInstructions(eol)+eol+eol+legacy+eol+'## Project rules'+eol+'Keep tests and @docs/rules.md.'+eol;
      originals.set(name,original);await fs.writeFile(path.join(f.a,name),original);
    }
    const e=await f.app.dispatch('add',{path:f.a});
    for(const name of originals.keys()){
      const text=await fs.readFile(path.join(f.a,name),'utf8');expect(text).not.toContain('entry.md');expect(text).not.toContain('工作流入口');expect(text).toContain('Keep tests and @docs/rules.md.');expect(text).toContain('cbim_workspace_identity');
    }
    const dir=path.join(f.app.paths.project(e.id),'host-instructions-backups'),backups=await fs.readdir(dir);expect(backups).toHaveLength(3);
    for(const [name,original] of originals)expect(await fs.readFile(path.join(dir,backups.find(b=>b.startsWith(name+'.'))!),'utf8')).toBe(original);
    await f.app.open(e.id);expect(await fs.readdir(dir)).toEqual(backups);
  }finally{await f.cleanup()}
});

it('preserves unrelated project instructions',async()=>{
  const f=await fixture();try{
    const custom='## Claude 开发约定\n\n项目规则见 docs/rules.md。\n提交前运行项目测试。\n';
    await fs.writeFile(path.join(f.a,'CLAUDE.md'),custom);await f.app.dispatch('add',{path:f.a});
    expect(await fs.readFile(path.join(f.a,'CLAUDE.md'),'utf8')).toBe(buildHostInstructions()+'\n\n'+custom);
  }finally{await f.cleanup()}
});

it('migrates legacy entry instructions to direct cbim MCP startup and preserves custom rules',async()=>{
  const f=await fixture();try{
    const old='# Custom rules\r\nKeep project tests.\r\n@.cbim/entry.md\r\n<!-- BEGIN CBIM ENTRY -->\r\nRead .cbim/entry.md first, then call workspace_identity.\r\n<!-- END CBIM ENTRY -->\r\n# Footer\r\n';
    for(const name of ['AGENTS.md','CLAUDE.md'])await fs.writeFile(path.join(f.a,name),old);
    const e=await f.app.dispatch('add',{path:f.a});
    for(const name of ['AGENTS.md','CLAUDE.md']){
      const target=path.join(f.a,name),text=await fs.readFile(target,'utf8');
      expect(text).toBe('# Custom rules\r\nKeep project tests.\r\n'+buildHostInstructions('\r\n')+'\r\n# Footer\r\n');
      expect(text).not.toContain('entry.md');
      for(const tool of ['workspace_identity','builtin_catalog','knowledge_search','knowledge_refresh']){
        expect(text).toContain('cbim_'+tool);expect(text).not.toMatch(new RegExp('(?<![A-Za-z0-9_])'+tool+'(?![A-Za-z0-9_])'));
      }
      for(const skill of builtinSkills)expect(text).toContain('| cbim_skill_'+skill.id.replaceAll('-','_')+' |');
    }
    const dir=path.join(f.app.paths.project(e.id),'host-instructions-backups'),backups=await fs.readdir(dir);expect(backups).toHaveLength(2);
    for(const backup of backups)expect(await fs.readFile(path.join(dir,backup),'utf8')).toBe(old);
    await f.app.open(e.id);expect(await fs.readdir(dir)).toEqual(backups);
  }finally{await f.cleanup()}
});

it('removes standalone legacy imports without removing unrelated imports or custom descriptions',async()=>{
  const f=await fixture();try{
    await fs.writeFile(path.join(f.a,'CLAUDE.md'),'@./.cbim/entry.md\n@docs/conventions.md\n# Custom rules\n');
    await f.app.dispatch('add',{path:f.a});
    expect(await fs.readFile(path.join(f.a,'CLAUDE.md'),'utf8')).toBe(buildHostInstructions()+'\n\n@docs/conventions.md\n# Custom rules\n');
  }finally{await f.cleanup()}
});

it('工作区自动安装两种入口指引，缺失可补齐，不创建覆盖文件',async()=>{
  const f=await fixture();try{
    const e=await f.app.dispatch('add',{path:f.a});
    expect(await fs.readFile(path.join(f.a,'AGENTS.md'),'utf8')).toContain(buildHostInstructions());
    expect(await fs.readFile(path.join(f.a,'CLAUDE.md'),'utf8')).toContain(buildHostInstructions());
    expect(await exists(path.join(f.a,'AGENTS.override.md'))).toBe(false);
    await fs.unlink(path.join(f.a,'CLAUDE.md'));await f.app.open(e.id);expect(await exists(path.join(f.a,'CLAUDE.md'))).toBe(true);
    expect(f.app.workspace(e.id).hostConfigWarnings).toEqual([]);
  }finally{await f.cleanup()}
});

it('保留 BOM、frontmatter、换行与现有指引；覆盖文件得到入口；重复打开不写入',async()=>{
  const f=await fixture();try{
    const original='\uFEFF---\r\nname: project\r\n---\r\n# 项目规则\r\n保持原有测试流程。\r\n';
    await fs.writeFile(path.join(f.a,'AGENTS.md'),original);await fs.writeFile(path.join(f.a,'AGENTS.override.md'),'# Override\n原有覆盖规则\n');
    const e=await f.app.dispatch('add',{path:f.a}),target=path.join(f.a,'AGENTS.md');const text=await fs.readFile(target,'utf8');
    expect(text.startsWith('\uFEFF---\r\nname: project\r\n---\r\n')).toBe(true);expect(text.endsWith('# 项目规则\r\n保持原有测试流程。\r\n')).toBe(true);
    expect(await fs.readFile(path.join(f.a,'AGENTS.override.md'),'utf8')).toContain(buildHostInstructions());
    const directory=path.join(f.app.paths.project(e.id),'host-instructions-backups'),backups=await fs.readdir(directory);expect(backups).toHaveLength(2);
    expect(await fs.readFile(path.join(directory,backups.find(x=>x.startsWith('AGENTS.md.'))!),'utf8')).toBe(original);
    const date=new Date('2020-01-01T00:00:00Z');await fs.utimes(target,date,date);const mtime=(await fs.stat(target)).mtimeMs;
    await f.app.open(e.id);expect((await fs.stat(target)).mtimeMs).toBe(mtime);expect(await fs.readdir(directory)).toEqual(backups);
  }finally{await f.cleanup()}
});

it('只替换托管区块，保留前后内容并备份完整旧文件',async()=>{
  const f=await fixture();try{
    const old='# before\n<!-- BEGIN CBIM ENTRY -->\nobsolete\n<!-- END CBIM ENTRY -->\n# after\n';await fs.writeFile(path.join(f.a,'CLAUDE.md'),old);
    const e=await f.app.dispatch('add',{path:f.a});expect(await fs.readFile(path.join(f.a,'CLAUDE.md'),'utf8')).toBe('# before\n'+buildHostInstructions()+'\n# after\n');
    const dir=path.join(f.app.paths.project(e.id),'host-instructions-backups'),files=await fs.readdir(dir);expect(await fs.readFile(path.join(dir,files[0]),'utf8')).toBe(old);
  }finally{await f.cleanup()}
});

it('损坏或重复的托管区块不覆盖，另一宿主正常安装且 MCP 继续运行',async()=>{
  const f=await fixture();try{
    const original='# custom\n<!-- BEGIN CBIM ENTRY -->\nmissing end\n';await fs.writeFile(path.join(f.a,'AGENTS.md'),original);
    const e=await f.app.dispatch('add',{path:f.a});expect(await fs.readFile(path.join(f.a,'AGENTS.md'),'utf8')).toBe(original);expect(await exists(path.join(f.a,'CLAUDE.md'))).toBe(true);
    expect(f.app.workspace(e.id).hostConfigWarnings[0]).toContain('AGENTS.md');expect(f.app.workspace(e.id).state).toBe('running');
    const duplicate=buildHostInstructions()+'\n'+buildHostInstructions();await fs.writeFile(path.join(f.a,'AGENTS.md'),duplicate);await f.app.open(e.id);expect(await fs.readFile(path.join(f.a,'AGENTS.md'),'utf8')).toBe(duplicate);
  }finally{await f.cleanup()}
});

it('拒绝链接和非 UTF-8 文件，备份失败不覆盖原指引',async()=>{
  const f=await fixture();try{
    const e=await f.app.catalog.add(f.a);await fs.symlink(f.b,path.join(f.a,'AGENTS.md'),'junction');const bytes=Buffer.from([0xff,0xfe,0x61,0x00]);await fs.writeFile(path.join(f.a,'CLAUDE.md'),bytes);
    await f.app.open(e.id);expect(f.app.workspace(e.id).hostConfigWarnings).toHaveLength(2);expect(await fs.readdir(f.b)).toEqual([]);expect(await fs.readFile(path.join(f.a,'CLAUDE.md'))).toEqual(bytes);
    await fs.unlink(path.join(f.a,'AGENTS.md'));await fs.writeFile(path.join(f.a,'AGENTS.md'),'# preserve');await fs.writeFile(path.join(f.app.paths.project(e.id),'host-instructions-backups'),'blocked');
    await f.app.open(e.id);expect(await fs.readFile(path.join(f.a,'AGENTS.md'),'utf8')).toBe('# preserve');expect(f.app.workspace(e.id).state).toBe('running');
  }finally{await f.cleanup()}
});
