import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {latestExecutable} from './build-artifact.mjs';
const sourceExecutable=await latestExecutable();
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-portable-test-'));
try{
  const install=path.join(temp,'installed'),root=path.join(temp,'project'),user=path.join(temp,'user');
  await fs.cp(path.dirname(sourceExecutable),install,{recursive:true});await fs.mkdir(root);await fs.mkdir(user);
  for(const [name,host] of [['CLAUDE.md','Claude'],['AGENTS.md','Codex']])await fs.writeFile(path.join(root,name),`## ${host} 工作流入口\n\n完整读取并立即执行 [CBIM 启动入口](.cbim/entry.md)。\n后续工作流加载与执行均由该入口路由，不在本文件展开流程规则。\n入口缺失或无法读取时，报告具体路径并停止工作流启动；不得自行回退到其他工作流。\n\n## Project rules\nKeep portable custom rules.\n`);
  const env={...process.env,PATH:path.join(process.env.SystemRoot||'C:\\Windows','System32'),CBIM_USER_DATA_ROOT:user,CBIM_SMOKE_ROOT:root};delete env.NODE_PATH;delete env.PYTHONHOME;delete env.PYTHONPATH;delete env.ELECTRON_RUN_AS_NODE;
  const child=spawn(path.join(install,'CBIM.exe'),[],{cwd:install,env,windowsHide:true,stdio:'pipe'});
  let stderr='';child.stderr.on('data',x=>stderr+=x);
  const code=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{child.kill();reject(Error('Portable startup timed out: '+stderr))},45000);child.on('error',reject);child.on('exit',c=>{clearTimeout(timer);resolve(c)})});if(code!==0)throw Error('Portable exit '+code+': '+stderr);
  const result=JSON.parse(await fs.readFile(path.join(user,'smoke-result.json'),'utf8'));if(!result.bridge||!result.packaged||!result.structural||result.mcp!=='running')throw Error(JSON.stringify(result));
  const agents=await fs.readFile(path.join(root,'AGENTS.md'),'utf8'),claude=await fs.readFile(path.join(root,'CLAUDE.md'),'utf8');if(!agents.includes('cbim_workspace_identity')||agents.includes('.cbim/entry.md')||!claude.includes('cbim_skill_knowledge_governance')||claude.includes('\n@.cbim/entry.md\n'))throw Error('Host entry instructions missing');
  for(const text of [agents,claude])if(text.includes('entry.md')||text.includes('工作流入口')||!text.includes('Keep portable custom rules.'))throw Error('Legacy host instructions migration failed');
  const settings=JSON.parse(await fs.readFile(path.join(root,'.claude/settings.local.json'),'utf8'));const hook=settings.hooks.PreToolUse.find(g=>g.hooks.some(h=>h.statusMessage==='CBIM knowledge access guard')).hooks.find(h=>h.statusMessage==='CBIM knowledge access guard');
  const runGuard=payload=>new Promise((resolve,reject)=>{const powershell=path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');const child=spawn(powershell,['-NoProfile','-NonInteractive','-Command',hook.command],{cwd:root,env,windowsHide:true,stdio:'pipe'});let text='';const timer=setTimeout(()=>{child.kill();reject(Error('Packaged hook timeout'))},15000);child.stdout.on('data',b=>text+=b);child.stderr.on('data',b=>text+=b);child.on('error',e=>{clearTimeout(timer);reject(e)});child.on('exit',code=>{clearTimeout(timer);resolve({code,text})});child.stdin.end(JSON.stringify(payload))});
  const denied=await runGuard({hook_event_name:'PreToolUse',cwd:root,tool_name:'Read',tool_input:{file_path:'.cbim/README.md'}});if(denied.code!==2)throw Error('Packaged hook failed to deny: '+denied.text);
  const allowed=await runGuard({hook_event_name:'PreToolUse',cwd:root,tool_name:'mcp__cbim-'+result.workspaceId+'__cbim_knowledge_snapshot',tool_input:{}});if(allowed.code!==0)throw Error('Packaged hook blocked MCP: '+allowed.text);
  await fs.mkdir('test-results',{recursive:true});const evidence={...result,hostEntryInstructions:true,packagedHook:true,copiedOutsideCheckout:true,pythonAndNodeAbsentFromPath:true,cleanMachine:false};await fs.writeFile('test-results/portable.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
}finally{await fs.rm(temp,{recursive:true,force:true,maxRetries:10,retryDelay:300})}
