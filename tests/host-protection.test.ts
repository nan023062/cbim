import {it,expect} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fixture} from './helpers';
import {guard} from '../src/backend/main/platform/tool-guard';
import {guardCommands} from '../src/backend/main/integrations/hosts/host-protection';
import {parse as parseToml} from 'smol-toml';

it('root listing and new business files work without allowing recursive knowledge access',()=>{
  const root=path.resolve('test-results/guard-root'),id='a'.repeat(64);
  const check=(tool_name:string,tool_input:any)=>guard({hook_event_name:'PreToolUse',cwd:root,tool_name,tool_input},root,id);
  expect(check('ls',{path:'.'})).toBeUndefined();
  expect(check('write',{path:'game/index.html',content:'<!doctype html>Game'})).toBeUndefined();
  expect(check('read',{path:'game/index.html'})).toBeUndefined();
  expect(check('ls',{path:'.cbim'})).toBeTruthy();
  expect(check('ls',{path:'.',recursive:true})).toBeTruthy();
  expect(check('grep',{path:'.',pattern:'secret'})).toBeTruthy();
});

it('宿主保护合并现有 Hook/权限，重复安装不重复，内联入口无导入依赖',async()=>{
  const f=await fixture();try{
    await fs.mkdir(path.join(f.a,'.claude'));await fs.writeFile(path.join(f.a,'.claude/settings.local.json'),JSON.stringify({permissions:{deny:['Read(.env)']},hooks:{PreToolUse:[{matcher:'Bash',hooks:[{type:'command',command:'existing-hook'}]}]}}));
    await fs.writeFile(path.join(f.a,'.ignore'),'existing/\n');
    const e=await f.app.dispatch('add',{path:f.a});expect(f.app.workspace(e.id).hostConfigWarnings).toEqual([]);
    const claude=JSON.parse(await fs.readFile(path.join(f.a,'.claude/settings.local.json'),'utf8'));expect(claude.hooks.PreToolUse).toHaveLength(2);expect(claude.permissions.deny).toContain('Read(.env)');expect(claude.permissions.deny).toContain('Edit(./.cbim/**)');
    const codex=parseToml(await fs.readFile(path.join(f.a,'.codex/config.toml'),'utf8'));expect(codex.default_permissions).toBe('cbim-knowledge');expect((codex.permissions as any)['cbim-knowledge'].filesystem[':workspace_roots']['.cbim']).toBe('deny');
    const before=await fs.readFile(path.join(f.a,'.codex/hooks.json'),'utf8');await f.app.open(e.id);expect(await fs.readFile(path.join(f.a,'.codex/hooks.json'),'utf8')).toBe(before);
    expect(await fs.readFile(path.join(f.a,'.ignore'),'utf8')).toContain('existing/\n');
    const entry=await fs.readFile(path.join(f.a,'CLAUDE.md'),'utf8');expect(entry).not.toContain('\n@.cbim/entry.md\n');expect(entry).toContain('cbim_object_commit');expect(entry).toContain('cbim_skill_create_workflow');
  }finally{await f.cleanup()}
});

it('Hook 拒绝知识文件、patch、明显 shell 与根搜索，正常源码和本工作区 MCP 可用',async()=>{
  const root=path.resolve('test-results/guard-root'),id='a'.repeat(64);
  const event=(tool_name:string,tool_input:any)=>({hook_event_name:'PreToolUse',cwd:root,tool_name,tool_input});
  for(const e of [event('Read',{file_path:'.cbim/team/a/agent.json'}),event('Edit',{file_path:'.CBIM/README.md'}),event('apply_patch',{patch:'*** Update File: .cbim/README.md'}),event('Bash',{command:'cat .cbim/entry.md'}),event('Grep',{path:'.',pattern:'secret'})])expect(guard(e,root,id)).toBeTruthy();
  expect(guard(event('Read',{file_path:'src/app.ts'}),root,id)).toBeUndefined();expect(guard(event('Bash',{command:'pnpm test'}),root,id)).toBeUndefined();
  expect(guard(event('mcp__cbim-'+id+'__cbim_knowledge_commit',{path:'.cbim/x'}),root,id)).toBeUndefined();
  expect(guard(event('mcp__filesystem__read_file',{path:'.cbim/x'}),root,id)).toBeTruthy();
});

it('生成的 Windows Hook 命令真实接收 stdin 并拒绝或放行，无需模型调用',async()=>{
  if(process.platform!=='win32')return;
  const f=await fixture();try{
    const entry=await f.app.catalog.add(f.a);const commands=guardCommands(entry,f.app.hostRuntime);
    const run=(tool_name:string,tool_input:any)=>new Promise<{code:number|null;out:string}>((resolve,reject)=>{
      const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',commands.commandWindows],{cwd:f.a,windowsHide:true,stdio:'pipe'});let out='';const timer=setTimeout(()=>{child.kill();reject(Error('Hook timeout'))},15000);child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>out+=b);child.on('error',reject);child.on('exit',code=>{clearTimeout(timer);resolve({code,out})});child.stdin.end(JSON.stringify({hook_event_name:'PreToolUse',cwd:f.a,tool_name,tool_input}));
    });
    const denied=await run('Read',{file_path:'.cbim/README.md'});expect(denied.code,denied.out).toBe(2);expect(denied.out).toContain('deny');
    const allowed=await run('mcp__cbim-'+entry.id+'__cbim_knowledge_snapshot',{});expect(allowed.code,allowed.out).toBe(0);
  }finally{await f.cleanup()}
});
