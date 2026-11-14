import {expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {ArtifactFiles} from '../src/logic/file-operations/platform/files/artifact-files';
import {jsonValidationLimits,type BoundedJsonSchema} from '../src/logic/workspace/rules/json-validation-schema';

const schema:BoundedJsonSchema={type:'object',properties:{count:{type:'integer',minimum:1}},required:['count'],additionalProperties:false};
const fact=(bytes:Buffer,relativePath='result.json')=>({relativePath,byteLength:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
async function fixture(){const root=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-json-validation-'));let alive=true;return {root,files:new ArtifactFiles(root,()=>{if(!alive)throw Error('retired')}),retire:()=>{alive=false},cleanup:async()=>{const target=path.resolve(root);if(path.dirname(target)!==path.resolve(os.tmpdir())||!path.basename(target).startsWith('cbim-json-validation-'))throw Error('Unsafe cleanup');await fs.rm(target,{recursive:true,force:true})}}}

it('同一次真实句柄读取产生哈希与结构结论，不再按路径打开文件或返回正文',async()=>{
  const f=await fixture(),bytes=Buffer.from('{"count":2}');try{
    await fs.writeFile(path.join(f.root,'result.json'),bytes);const opened=vi.spyOn(fs,'open');
    const result=await f.files.validateFile(fact(bytes),schema,new AbortController().signal);expect(result).toEqual({artifact:fact(bytes),outcome:'passed',issues:[]});expect(opened).toHaveBeenCalledTimes(1);expect(result).not.toHaveProperty('text');expect(result).not.toHaveProperty('bytes');opened.mockRestore();
  }finally{vi.restoreAllMocks();await f.cleanup()}
});
it('非法 UTF-8、重复字段和结构不合格保存精确原字节指纹与无原值 rejected 事实',async()=>{
  const f=await fixture();try{for(const bytes of [Buffer.from([123,34,120,34,58,34,255,34,125]),Buffer.from('{"count":1,"count":2}'),Buffer.from('{"count":"DO_NOT_DISCLOSE"}'),Buffer.from('{')]){
    await fs.writeFile(path.join(f.root,'result.json'),bytes);const result=await f.files.validateFile(fact(bytes),schema,new AbortController().signal);expect(result.artifact).toEqual(fact(bytes));expect(result.outcome).toBe('rejected');expect(result.issues.length).toBeGreaterThan(0);expect(JSON.stringify(result.issues)).not.toContain('DO_NOT_DISCLOSE');
  }}finally{await f.cleanup()}
});
it('变更/缺失文件与 1 MiB 上限明确失败，不用旧基线或截断字节冒充验证',async()=>{
  const f=await fixture(),original=Buffer.from('{"count":1}'),signal=new AbortController().signal;try{
    await fs.writeFile(path.join(f.root,'result.json'),'{"count":2}');await expect(f.files.validateFile(fact(original),schema,signal)).rejects.toMatchObject({code:'VALIDATION_BASELINE_CHANGED'});
    await fs.unlink(path.join(f.root,'result.json'));await expect(f.files.validateFile(fact(original),schema,signal)).rejects.toMatchObject({code:'ENOENT'});
    const large=Buffer.alloc(jsonValidationLimits.fileBytes+1,32);await fs.writeFile(path.join(f.root,'result.json'),large);await expect(f.files.validateFile(fact(large),schema,signal)).rejects.toMatchObject({code:'VALIDATION_LIMIT'});
  }finally{await f.cleanup()}
});
it('验证保留产物路径、链接、目录和设备保护，原生数据流不能混入同文件',async()=>{
  const f=await fixture(),bytes=Buffer.from('{"count":1}'),signal=new AbortController().signal;try{
    await fs.writeFile(path.join(f.root,'result.json'),bytes);await fs.mkdir(path.join(f.root,'directory'));await fs.mkdir(path.join(f.root,'.cbim'));await fs.link(path.join(f.root,'result.json'),path.join(f.root,'hard.json'));
    for(const relativePath of ['../escape.json','.cbim/secret','directory','result.json:secret','NUL','hard.json'])await expect(f.files.validateFile(fact(bytes,relativePath),schema,signal)).rejects.toBeTruthy();
    await fs.symlink(path.join(f.root,'directory'),path.join(f.root,'alias'),'junction');await expect(f.files.validateFile(fact(bytes,'alias/result.json'),schema,signal)).rejects.toMatchObject({code:'ARTIFACT_PATH'});
  }finally{await f.cleanup()}
});
it('实际读取过程中追加文件会被句柄和路径后检查拒绝，不能按旧大小声明通过',async()=>{
  const f=await fixture(),bytes=Buffer.from('{"count":1}');try{
    const file=path.join(f.root,'result.json');await fs.writeFile(file,bytes);const open=fs.open.bind(fs);let changed=false;
    vi.spyOn(fs,'open').mockImplementation(async(...args:Parameters<typeof fs.open>)=>{const handle=await open(...args),read=handle.read.bind(handle);handle.read=(async(...readArgs:unknown[])=>{const result=await (read as (...args:unknown[])=>Promise<{bytesRead:number}>)(...readArgs);if(!changed){changed=true;await fs.appendFile(file,' ')}return result}) as typeof handle.read;return handle});
    await expect(f.files.validateFile(fact(bytes),schema,new AbortController().signal)).rejects.toMatchObject({code:'ARTIFACT_CHANGED'});expect(changed).toBe(true);
  }finally{vi.restoreAllMocks();await f.cleanup()}
});
it('停止和工作区退役仍中止只读验证，不让当前 Schema 或读取路径绕过所有者',async()=>{
  const f=await fixture(),bytes=Buffer.from('{"count":1}');try{
    await fs.writeFile(path.join(f.root,'result.json'),bytes);const abort=new AbortController();abort.abort(Error('stopped'));await expect(f.files.validateFile(fact(bytes),schema,abort.signal)).rejects.toThrow('stopped');f.retire();await expect(f.files.validateFile(fact(bytes),schema,new AbortController().signal)).rejects.toThrow('retired');
  }finally{await f.cleanup()}
});
