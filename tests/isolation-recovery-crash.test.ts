import {it,expect} from 'vitest';import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {spawn} from 'node:child_process';
import {FileIsolationRecords} from '../src/backend/main/platform/isolation/isolation-records';import {isolationPlatform} from './isolation-recovery-fixture';
const test=process.platform==='win32'?it:it.skip,alive=(pid:number)=>{try{process.kill(pid,0);return true}catch{return false}},pause=()=>new Promise(resolve=>setTimeout(resolve,20));
test('真实宿主崩溃后原可靠日志仍可核对，Job收束主程序和后代，按原对象显式清理',async()=>{
 const temp=await fs.realpath(os.tmpdir()),directory=await fs.mkdtemp(path.join(temp,'cbim-isolation-records-')),platform=isolationPlatform(),records=new FileIsolationRecords(path.join(directory,'records'));
 const child=spawn(process.execPath,['--import','tsx','tests/isolation-recovery-crash-host.ts',directory],{windowsHide:true,stdio:['ignore','ignore','pipe']});let stderr='';child.stderr.on('data',b=>{stderr+=b});const exit=new Promise(resolve=>child.once('exit',resolve));let root:string|undefined,failure:unknown;
 try{let ready:{pid:number;child:number}|undefined;const until=Date.now()+15000;while(!ready){if(child.exitCode!==null)throw Error(stderr);if(Date.now()>until)throw Error('fixture timeout '+stderr);try{root=JSON.parse(await fs.readFile(path.join(directory,'receipt.json'),'utf8')).root;ready=JSON.parse(await fs.readFile(path.join(root!,'output','ready.json'),'utf8'))}catch{}await pause()}
  const head=(await records.list('run-one'))[0].head;expect(head.phase).toBe('started');expect(platform.host(head.record.resource.host)).toBe('live');expect(alive(ready.pid)).toBe(true);expect(alive(ready.child)).toBe(true);child.kill();await exit;const untilGone=Date.now()+5000;while((alive(ready.pid)||alive(ready.child))&&Date.now()<untilGone)await pause();expect(alive(ready.pid)).toBe(false);expect(alive(ready.child)).toBe(false);expect(platform.host(head.record.resource.host)).toBe('exited');expect(['absent','empty']).toContain(platform.job(head.record.resource));
  const tree=platform.lockTree(head.record.resource,true);try{platform.deleteProfile(head.record.resource);tree.remove()}finally{tree.close()}await expect(fs.access(root!)).rejects.toBeDefined();expect((await records.list('run-one'))[0].head).toEqual(head);
 }catch(error){
  // 原目录必须保留供核实，但后续清理失败不能覆盖触发保留的原始断言或平台错误。
  failure=error;const diagnostic={directory,root,stderr,hostExitCode:child.exitCode,hostSignalCode:child.signalCode,error:error instanceof Error?{...error,name:error.name,message:error.message,stack:error.stack}:String(error),records:await records.list('run-one').catch(readError=>({readError:String(readError)}))};
  console.error('Isolation crash recovery primary failure',diagnostic);
  await fs.mkdir('test-results',{recursive:true}).then(()=>fs.writeFile('test-results/isolation-recovery-crash-failure.json',JSON.stringify(diagnostic,null,2))).catch(writeError=>console.error('Could not preserve crash diagnostic',writeError));
  throw error;
 }finally{if(child.exitCode===null){child.kill();await exit}if(root)await fs.access(root).then(()=>{throw new Error('保留未完成核实的原隔离目录 '+root,{cause:failure})},()=>{});if(path.dirname(directory)!==temp||!path.basename(directory).startsWith('cbim-isolation-records-'))throw Error('cleanup');await fs.rm(directory,{recursive:true,force:true})}
},30000);
