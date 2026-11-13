import {expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {ArtifactFiles} from '../src/backend/main/platform/files/artifact-files';
import {csvValidationLimits} from '../src/logic/workspace/rules/csv-validation-schema';
import {csvValidationData as d} from './csv-validation-data';
const fact=(bytes:Buffer,relativePath=d.file)=>({relativePath,byteLength:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
async function fixture(){const root=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-csv-platform-'));let alive=true;return {root,files:new ArtifactFiles(root,()=>{if(!alive)throw Error('retired')}),retire:()=>{alive=false},cleanup:async()=>{const target=path.resolve(root);expect(path.dirname(target)).toBe(path.resolve(os.tmpdir()));expect(path.basename(target)).toMatch(/^cbim-csv-platform-/);await fs.rm(target,{recursive:true,force:true})}}}

it('实际CSV的指纹和检查来自同次句柄读取，不返回表格正文',async()=>{
  const f=await fixture(),bytes=Buffer.from(d.good);try{await fs.writeFile(path.join(f.root,d.file),bytes);const open=vi.spyOn(fs,'open');expect(await f.files.validateTable(fact(bytes),d.schema,new AbortController().signal)).toEqual({artifact:fact(bytes),outcome:'passed',issues:[]});expect(open).toHaveBeenCalledTimes(1)}finally{vi.restoreAllMocks();await f.cleanup()}
});
it('坏UTF8、字段与唯一键失败保留原文件指纹，诊断不含原字段值',async()=>{
  const f=await fixture();try{for(const bytes of [Buffer.from([0xff]),Buffer.from(d.bad),Buffer.from('sku,quantity,location\n"SECRET')]){await fs.writeFile(path.join(f.root,d.file),bytes);const result=await f.files.validateTable(fact(bytes),d.schema,new AbortController().signal);expect(result).toMatchObject({artifact:fact(bytes),outcome:'rejected'});expect(JSON.stringify(result.issues)).not.toMatch(/SECRET|SKU-001|not-an-integer/)}}finally{await f.cleanup()}
});
it('CSV端口不能绕过原基线、文件大小、链接和路径保护',async()=>{
  const f=await fixture(),bytes=Buffer.from(d.good),signal=new AbortController().signal,file=path.join(f.root,d.file);try{
    await fs.writeFile(file,d.changed);await expect(f.files.validateTable(fact(bytes),d.schema,signal)).rejects.toMatchObject({code:'VALIDATION_BASELINE_CHANGED'});
    await fs.unlink(file);await expect(f.files.validateTable(fact(bytes),d.schema,signal)).rejects.toMatchObject({code:'ENOENT'});
    const huge=Buffer.alloc(csvValidationLimits.fileBytes+1);await fs.writeFile(file,huge);await expect(f.files.validateTable(fact(huge),d.schema,signal)).rejects.toMatchObject({code:'VALIDATION_LIMIT'});
    await fs.writeFile(file,bytes);await fs.link(file,path.join(f.root,'hard.csv'));for(const relativePath of ['../escape.csv','.cbim/secret','inventory.csv:stream','NUL','hard.csv'])await expect(f.files.validateTable(fact(bytes,relativePath),d.schema,signal)).rejects.toBeTruthy();
    await fs.mkdir(path.join(f.root,'folder'));await fs.symlink(path.join(f.root,'folder'),path.join(f.root,'alias'),'junction');await expect(f.files.validateTable(fact(bytes,'alias/value.csv'),d.schema,signal)).rejects.toMatchObject({code:'ARTIFACT_PATH'});
  }finally{await f.cleanup()}
});
it('CSV真实读取中修改、停止与所有者退役都不能保留通过结论',async()=>{
  const f=await fixture(),bytes=Buffer.from(d.good),file=path.join(f.root,d.file);try{
    await fs.writeFile(file,bytes);const original=fs.open.bind(fs);let changed=false;
    vi.spyOn(fs,'open').mockImplementation(async(...args:Parameters<typeof fs.open>)=>{const handle=await original(...args),read=handle.read.bind(handle);handle.read=(async(...args:unknown[])=>{const result=await(read as(...args:unknown[])=>Promise<unknown>)(...args);if(!changed){changed=true;await fs.appendFile(file,' ')}return result}) as typeof handle.read;return handle});
    await expect(f.files.validateTable(fact(bytes),d.schema,new AbortController().signal)).rejects.toMatchObject({code:'ARTIFACT_CHANGED'});expect(changed).toBe(true);vi.restoreAllMocks();
    const abort=new AbortController();abort.abort(Error('stopped'));await expect(f.files.validateTable(fact(bytes),d.schema,abort.signal)).rejects.toThrow('stopped');f.retire();await expect(f.files.validateTable(fact(bytes),d.schema,new AbortController().signal)).rejects.toThrow('retired');
  }finally{vi.restoreAllMocks();await f.cleanup()}
});
