import {it,expect} from 'vitest';import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {spawn} from 'node:child_process';import koffi from 'koffi';
const test=process.platform==='win32'&&process.arch==='x64'?it:it.skip;
const alive=(pid:number)=>{try{process.kill(pid,0);return true}catch{return false}};
const wait=()=>new Promise<void>(resolve=>setTimeout(resolve,20));
test('真实宿主被强制终止后Job仍收束整个进程树；孤儿只保留原身份而不重放',async()=>{
 const fixture=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-isolation-crash-')),receipt=path.join(fixture,'receipt.json');let record:{pid:number;root:string;profileName:string}|undefined,descendant=0;let stderr='';
 const child=spawn(process.execPath,['--import','tsx','tests/isolated-node-crash-host.ts',receipt],{windowsHide:true,stdio:['ignore','ignore','pipe']});child.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-8192)});const exit=new Promise(resolve=>child.once('exit',resolve));
 try{
  const deadline=Date.now()+15000;while(!record||!descendant){if(child.exitCode!==null)throw Error('宿主提前退出：'+stderr);if(Date.now()>deadline)throw Error('宿主未准备好：'+stderr);try{record=JSON.parse(await fs.readFile(receipt,'utf8'));descendant=JSON.parse(await fs.readFile(path.join(record!.root,'output','descendant.json'),'utf8')).pid}catch{}await wait()}
  expect(alive(record.pid)).toBe(true);expect(alive(descendant)).toBe(true);child.kill();await exit;
  const until=Date.now()+5000;while((alive(record.pid)||alive(descendant))&&Date.now()<until)await wait();expect(alive(record.pid)).toBe(false);expect(alive(descendant)).toBe(false);
  const owner=JSON.parse(await fs.readFile(path.join(record.root,'owner.json'),'utf8'));expect(owner.profileName).toBe(record.profileName);expect(owner.pid).toBe(child.pid);expect(record.profileName).toMatch(/^CBIM\.Isolated\.[a-f0-9-]{36}$/);
 }finally{
  if(child.exitCode===null){child.kill();await exit}
  // 已先核实整棵进程树退出与临时目录身份；Windows 仍可能短暂锁住 EXE，清理只做有界重试，不放宽退出断言。
  if(record){expect(alive(record.pid)).toBe(false);if(descendant)expect(alive(descendant)).toBe(false);expect(path.dirname(record.root)).toBe(await fs.realpath(os.tmpdir()));expect(path.basename(record.root)).toMatch(/^cbim-isolated-[A-Za-z0-9]+$/);const owner=JSON.parse(await fs.readFile(path.join(record.root,'owner.json'),'utf8'));expect(owner.profileName).toBe(record.profileName);const remove=koffi.load('userenv.dll').func('int32 __stdcall DeleteAppContainerProfile(str16)');expect(remove(record.profileName)).toBe(0);await fs.rm(record.root,{recursive:true,force:true,maxRetries:10,retryDelay:100})}
  if(path.dirname(fixture)!==os.tmpdir()||!path.basename(fixture).startsWith('cbim-isolation-crash-'))throw Error('cleanup');await fs.rm(fixture,{recursive:true,force:true});
 }
});
