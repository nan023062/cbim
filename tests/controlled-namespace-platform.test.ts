import {it,expect} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import {Win32ControlledFile} from '../src/logic/file-operations/platform/files/controlled-file-win32';
import type {ControlledNamespaceChange} from '../src/logic/file-operations/platform/files/controlled-file-protocol';

const native=createRequire(import.meta.url),test=process.platform==='win32'&&process.arch==='x64'?it:it.skip;
async function fixture(){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-namespace-platform-')),source=path.join(root,'source.txt');await fs.writeFile(source,'\uFEFF原文件\r\n');
  return {root,source,open:(change:ControlledNamespaceChange,relative='source.txt',protectedRoots:string[]=[])=>new Win32ControlledFile(root,relative,protectedRoots,native.resolve('koffi'),change),async cleanup(){const resolved=path.resolve(root);if(path.dirname(resolved)!==path.resolve(os.tmpdir())||!path.basename(resolved).startsWith('cbim-namespace-platform-'))throw Error('unsafe cleanup');await fs.rm(resolved,{recursive:true,force:true})}};
}
test('同一独占句柄真实删除，报告原字节与身份；关闭源句柄后才确认缺失',async()=>{
  const f=await fixture();let file:Win32ControlledFile|undefined;
  try{file=f.open({kind:'delete'});const before=file.read();expect(file.writeIssued).toBe(false);expect(()=>file!.replace(Buffer.from('bypass'))).toThrow();const result=file.transition();expect(result).toMatchObject({identity:before.identity,fact:before.fact,transition:{kind:'delete'},sourceMissing:true});expect(file.writeIssued).toBe(true);await expect(fs.lstat(f.source)).rejects.toMatchObject({code:'ENOENT'});expect(()=>file!.transition()).toThrow();file.close();file=undefined;await expect(fs.lstat(f.source)).rejects.toMatchObject({code:'ENOENT'})}finally{file?.close();await f.cleanup()}
});
test('跨已存在父目录移动保留原文件身份及全部字节，目标保持独占且不能重发',async()=>{
  const f=await fixture();let file:Win32ControlledFile|undefined;
  try{await fs.mkdir(path.join(f.root,'target'));const target=path.join(f.root,'target','moved.txt');file=f.open({kind:'move',targetRelativePath:'target/moved.txt'});const before=file.read();await expect(fs.rename(path.join(f.root,'target'),path.join(f.root,'other'))).rejects.toBeDefined();const result=file.transition();expect(result.identity).toEqual(before.identity);expect(result.fact).toEqual(before.fact);await expect(fs.lstat(f.source)).rejects.toMatchObject({code:'ENOENT'});await expect(fs.readFile(target)).rejects.toBeDefined();expect(()=>file!.transition()).toThrow();file.close();file=undefined;expect(await fs.readFile(target)).toEqual(before.bytes)}finally{file?.close();await f.cleanup()}
});
test.each(['source.txt','SOURCE.txt','../outside.txt','.cbim/file.txt','.git/file.txt','other:stream','missing/file.txt'])('拒绝目标 %s，原文件不变',async target=>{
  const f=await fixture();try{expect(()=>f.open({kind:'move',targetRelativePath:target})).toThrow();expect(await fs.readFile(f.source,'utf8')).toBe('\uFEFF原文件\r\n')}finally{await f.cleanup()}
});
test('已有目标及打开后的目标竞争均不能被覆盖',async()=>{
  const f=await fixture();let file:Win32ControlledFile|undefined;
  try{const target=path.join(f.root,'target.txt');await fs.writeFile(target,'existing');expect(()=>f.open({kind:'move',targetRelativePath:'target.txt'})).toThrow();await fs.unlink(target);file=f.open({kind:'move',targetRelativePath:'target.txt'});await fs.writeFile(target,'raced');expect(()=>file!.transition()).toThrow();expect(file.writeIssued).toBe(false);file.close();file=undefined;expect(await fs.readFile(target,'utf8')).toBe('raced');expect(await fs.readFile(f.source,'utf8')).toBe('\uFEFF原文件\r\n')}finally{file?.close();await f.cleanup()}
});
test('备用数据流、硬链接及受保护范围均拒绝，不以默认流摘要代表被删除内容',async()=>{
  const f=await fixture();try{await fs.writeFile(f.source+':private','alternate');expect(()=>f.open({kind:'delete'})).toThrow('CONTROLLED_ALTERNATE_STREAM');expect(await fs.readFile(f.source+':private','utf8')).toBe('alternate');await fs.unlink(f.source+':private');const alias=path.join(f.root,'alias.txt');await fs.link(f.source,alias);expect(()=>f.open({kind:'delete'})).toThrow();await fs.unlink(alias);expect(()=>f.open({kind:'delete'},'source.txt',[f.root])).toThrow();expect(await fs.readFile(f.source,'utf8')).toBe('\uFEFF原文件\r\n')}finally{await f.cleanup()}
});
test('空文件可实际删除；冻结操作不受调用方改写目标影响',async()=>{
  const f=await fixture();let file:Win32ControlledFile|undefined;
  try{await fs.writeFile(f.source,'');file=f.open({kind:'delete'});expect(file.transition().fact.byteLength).toBe(0);file.close();file=undefined;await fs.writeFile(f.source,'content');const change:ControlledNamespaceChange={kind:'move',targetRelativePath:'chosen.txt'};file=f.open(change);change.targetRelativePath='changed.txt';expect(file.transition().transition).toEqual({kind:'move',targetRelativePath:'chosen.txt'});file.close();file=undefined;expect(await fs.readFile(path.join(f.root,'chosen.txt'),'utf8')).toBe('content');await expect(fs.lstat(path.join(f.root,'changed.txt'))).rejects.toMatchObject({code:'ENOENT'})}finally{file?.close();await f.cleanup()}
});
