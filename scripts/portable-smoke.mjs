import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {latestExecutable} from './build-artifact.mjs';

// 复制到仓库外运行，验证随应用打包的内部知识服务，不依赖宿主配置或系统 Node/Python。
const sourceExecutable=await latestExecutable();
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-portable-test-'));
try{
  const install=path.join(temp,'installed'),root=path.join(temp,'project'),user=path.join(temp,'user');
  await fs.cp(path.dirname(sourceExecutable),install,{recursive:true});await fs.mkdir(root);await fs.mkdir(user);
  const hostFiles={'CLAUDE.md':'# Existing Claude rules\nKeep portable custom rules.\n','AGENTS.md':'# Existing agent rules\nKeep portable custom rules.\n','.ignore':'own-ignore/\n'};
  for(const [name,text] of Object.entries(hostFiles))await fs.writeFile(path.join(root,name),text);
  const env={...process.env,PATH:path.join(process.env.SystemRoot||'C:\\Windows','System32'),CBIM_USER_DATA_ROOT:user,CBIM_SMOKE_ROOT:root};
  delete env.NODE_PATH;delete env.PYTHONHOME;delete env.PYTHONPATH;delete env.ELECTRON_RUN_AS_NODE;
  const child=spawn(path.join(install,'CBIM.exe'),[],{cwd:install,env,windowsHide:true,stdio:'pipe'});
  let stderr='';child.stderr.on('data',x=>stderr+=x);
  const code=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{child.kill();reject(Error('便携程序启动超时：'+stderr))},45000);
    child.on('error',error=>{clearTimeout(timer);reject(error)});child.on('exit',value=>{clearTimeout(timer);resolve(value)});
  });
  assert.equal(code,0,'便携程序退出异常：'+stderr);
  const result=JSON.parse(await fs.readFile(path.join(user,'smoke-result.json'),'utf8'));
  for(const key of ['packaged','structural','internalKnowledge','builtins','objectCrud'])assert.equal(result[key],true,key);
  assert.equal(result.workspaceState,'running');assert.ok(result.files>0);
  assert.equal('mcp' in result,false);assert.equal('bridge' in result,false);
  for(const [name,text] of Object.entries(hostFiles))assert.equal(await fs.readFile(path.join(root,name),'utf8'),text,name);
  for(const relative of ['.mcp.json','.codex','.claude','.rgignore','.cursorignore','AGENTS.override.md','.cbim/entry.md'])await assert.rejects(fs.access(path.join(root,relative)),{code:'ENOENT'});
  for(const name of ['discovery.json','credentials.json'])await assert.rejects(fs.access(path.join(user,result.workspaceId,name)),{code:'ENOENT'});
  await fs.mkdir('test-results',{recursive:true});
  const evidence={...result,hostFilesUnchanged:true,noHostInstallation:true,noExternalCredentials:true,copiedOutsideCheckout:true,pythonAndNodeAbsentFromPath:true,cleanMachine:false};
  await fs.writeFile('test-results/portable.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
}finally{
  const resolved=path.resolve(temp);
  if(path.dirname(resolved)!==path.resolve(os.tmpdir())||!path.basename(resolved).startsWith('cbim-portable-test-'))throw Error('拒绝清理非本次便携包测试目录');
  await fs.rm(resolved,{recursive:true,force:true,maxRetries:10,retryDelay:300});
}
