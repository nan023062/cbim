import {expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {ArtifactFiles} from '../src/backend/main/platform/files/artifact-files';
import {pngValidationData as d,pngBytes} from './png-validation-data';
const bytes=Buffer.from(d.good,'base64'),fact=(value:Uint8Array,relativePath=d.file)=>({relativePath,byteLength:value.byteLength,sha256:createHash('sha256').update(value).digest('hex')});
async function fixture(){const root=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-png-platform-'));let alive=true;return {root,file:path.join(root,d.file),port:new ArtifactFiles(root,()=>{if(!alive)throw Error('retired')}),retire:()=>{alive=false},cleanup:async()=>{const target=path.resolve(root);expect(path.dirname(target)).toBe(path.resolve(os.tmpdir()));expect(path.basename(target)).toMatch(/^cbim-png-platform-/);await fs.rm(target,{recursive:true,force:true})}}}
it('真实PNG只打开一次，同字节哈希及解码结果不返回像素或文本',async()=>{
 const f=await fixture();try{await fs.writeFile(f.file,bytes);const opened=vi.spyOn(fs,'open');expect(await f.port.validateImage(fact(bytes),d.schema,new AbortController().signal)).toEqual({artifact:fact(bytes),outcome:'passed',issues:[]});expect(opened).toHaveBeenCalledTimes(1)}finally{vi.restoreAllMocks();await f.cleanup()}
});
it('坏文件与尺寸不符保留原检查事实；变化/链接/越界/超限不能得到通过',async()=>{
 const f=await fixture(),signal=new AbortController().signal;try{
  for(const value of [Buffer.from('PRIVATE-PIXELS'),Buffer.from(d.bad,'base64')]){await fs.writeFile(f.file,value);const result=await f.port.validateImage(fact(value),d.schema,signal);expect(result).toMatchObject({artifact:fact(value),outcome:'rejected'});expect(JSON.stringify(result)).not.toContain('PRIVATE')}
  await fs.writeFile(f.file,Buffer.from(d.changed,'base64'));await expect(f.port.validateImage(fact(bytes),d.schema,signal)).rejects.toMatchObject({code:'VALIDATION_BASELINE_CHANGED'});
  const huge=pngBytes({width:4096,height:4096,raw:Buffer.alloc(1)});await fs.writeFile(f.file,huge);await expect(f.port.validateImage(fact(huge),d.schema,signal)).rejects.toMatchObject({code:'VALIDATION_LIMIT'});
  await fs.writeFile(f.file,bytes);await fs.link(f.file,path.join(f.root,'alias.png'));for(const relativePath of ['../out.png','.cbim/hidden','status-icon.png:ads','alias.png'])await expect(f.port.validateImage(fact(bytes,relativePath),d.schema,signal)).rejects.toBeTruthy();
 }finally{await f.cleanup()}
});
it('实际PNG读取中修改、取消和工作区失效均不能保留迟到通过',async()=>{
 const f=await fixture();try{await fs.writeFile(f.file,bytes);const original=fs.open.bind(fs);let changed=false;vi.spyOn(fs,'open').mockImplementation(async(...args:Parameters<typeof fs.open>)=>{const handle=await original(...args),read=handle.read.bind(handle);handle.read=(async(...args:unknown[])=>{const result=await(read as(...args:unknown[])=>Promise<unknown>)(...args);if(!changed){changed=true;await fs.appendFile(f.file,' ')}return result})as typeof handle.read;return handle});await expect(f.port.validateImage(fact(bytes),d.schema,new AbortController().signal)).rejects.toMatchObject({code:'ARTIFACT_CHANGED'});expect(changed).toBe(true);vi.restoreAllMocks();const stop=new AbortController();stop.abort(Error('stopped'));await expect(f.port.validateImage(fact(bytes),d.schema,stop.signal)).rejects.toThrow('stopped');f.retire();await expect(f.port.validateImage(fact(bytes),d.schema,new AbortController().signal)).rejects.toThrow('retired')}finally{vi.restoreAllMocks();await f.cleanup()}
});
