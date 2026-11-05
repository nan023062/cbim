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
  const env={...process.env,PATH:path.join(process.env.SystemRoot||'C:\\Windows','System32'),CBIM_USER_DATA_ROOT:user,CBIM_SMOKE_ROOT:root};delete env.NODE_PATH;delete env.PYTHONHOME;delete env.PYTHONPATH;delete env.ELECTRON_RUN_AS_NODE;
  const child=spawn(path.join(install,'CBIM Assistant.exe'),[],{cwd:install,env,windowsHide:true,stdio:'pipe'});
  let stderr='';child.stderr.on('data',x=>stderr+=x);
  const code=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{child.kill();reject(Error('Portable startup timed out: '+stderr))},45000);child.on('error',reject);child.on('exit',c=>{clearTimeout(timer);resolve(c)})});if(code!==0)throw Error('Portable exit '+code+': '+stderr);
  const result=JSON.parse(await fs.readFile(path.join(user,'smoke-result.json'),'utf8'));if(!result.packaged||!result.structural||result.mcp!=='running')throw Error(JSON.stringify(result));
  await fs.mkdir('test-results',{recursive:true});const evidence={...result,copiedOutsideCheckout:true,pythonAndNodeAbsentFromPath:true,cleanMachine:false};await fs.writeFile('test-results/portable.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
}finally{await fs.rm(temp,{recursive:true,force:true,maxRetries:10,retryDelay:300})}
