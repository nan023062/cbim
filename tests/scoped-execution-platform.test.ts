import {it,expect} from 'vitest';
import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {ScopedExecutionFiles} from '../src/backend/main/platform/files/scoped-execution-files';
import {ArtifactFiles} from '../src/backend/main/platform/files/artifact-files';
import {OutputManifestFiles} from '../src/backend/main/platform/files/output-manifest-files';
import type {ExecutionScope} from '../src/backend/core/workspace/execution-scope';
async function fixture(){const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'cbim-scoped-platform-')));await fs.mkdir(path.join(root,'src'));await fs.writeFile(path.join(root,'src','data.txt'),'actual');await fs.writeFile(path.join(root,'private.txt'),'PRIVATE_SENTINEL');const scope:ExecutionScope={version:1,profile:'windows-lpac-node-v1',read:[{path:'src',kind:'directory'}],write:[],node:{timeoutMs:1500,memoryMiB:512,processLimit:2}},port=new ScopedExecutionFiles(root,scope,()=>{});return {root,port,scope,close:async()=>{await port.drain();if(path.dirname(root)!==await fs.realpath(os.tmpdir())||!/^cbim-scoped-platform-/.test(path.basename(root)))throw Error('cleanup');await fs.rm(root,{recursive:true,force:true,maxRetries:5})}}}
it('实际Win32只读文件可读；范围外和目录联接拒绝，枚举锁期间父目录不能被替换',async()=>{
 const f=await fixture();try{
  await fs.chmod(path.join(f.root,'src','data.txt'),0o444);expect(await f.port.read('src/data.txt',new AbortController().signal)).toMatchObject({content:'actual',file:{byteLength:6}});
  await expect(f.port.read('private.txt',new AbortController().signal)).rejects.toMatchObject({code:'EXECUTION_SCOPE_DENIED'});
  const release=f.port.lockDirectory('src');try{await expect(fs.rename(path.join(f.root,'src'),path.join(f.root,'moved'))).rejects.toBeDefined()}finally{release()}
  await fs.mkdir(path.join(f.root,'outside'));await fs.writeFile(path.join(f.root,'outside','data.txt'),'OUTSIDE');await fs.symlink(path.join(f.root,'outside'),path.join(f.root,'src','link'),'junction');await expect(f.port.read('src/link/data.txt',new AbortController().signal)).rejects.toBeDefined();expect(await fs.readFile(path.join(f.root,'outside','data.txt'),'utf8')).toBe('OUTSIDE');
 }finally{await fs.chmod(path.join(f.root,'src','data.txt'),0o666);await f.close()}
});
it('产物与完整目录清单复用受限读取；新增真实文件使完整集合变化',async()=>{
 const f=await fixture();try{
  const files=new ArtifactFiles(f.root,()=>{},(p,s)=>f.port.snapshot(p,s)),manifests=new OutputManifestFiles(f.root,()=>{},{files,lockDirectory:p=>f.port.lockDirectory(p)}),signal=new AbortController().signal;
  await expect(files.captureFiles(['private.txt'],signal)).rejects.toMatchObject({code:'EXECUTION_SCOPE_DENIED'});
  const scopes=[{moduleId:'module',workflowId:'workflow',workflowVersion:'1',scope:{version:1 as const,roots:[{path:'src',kind:'directory' as const}]}}],first=await manifests.capture(scopes,signal);expect(first.entries).toHaveLength(2);await fs.writeFile(path.join(f.root,'src','new.txt'),'new');expect((await manifests.check(first,signal)).state).toBe('changed');
 }finally{await f.close()}
});
it('实际LPAC读取复制输入并返回私有输出；不能读原工程或泄漏环境，原文件不回写',async()=>{
 const f=await fixture();try{
  const script="const fs=require('fs'),path=require('path');if(fs.readFileSync(path.join(__dirname,'data.txt'),'utf8')!=='actual')process.exit(2);try{fs.readFileSync(process.argv[2]);process.exit(3)}catch(e){if(!['EACCES','EPERM'].includes(e.code))throw e}if(process.env.CBIM_SCOPED_SECRET)process.exit(4);fs.writeFileSync('out.txt','computed');";await fs.writeFile(path.join(f.root,'src','main.cjs'),script);process.env.CBIM_SCOPED_SECRET='secret';
  const result=await f.port.node({entry:'src/main.cjs',files:['src/main.cjs','src/data.txt'],args:[path.join(f.root,'private.txt')],outputs:['out.txt']},new AbortController().signal);expect(result).toMatchObject({status:'exited',exitCode:0,cleanup:'complete',allProcessesExited:true});expect(Buffer.from(result.outputs[0].base64,'base64').toString()).toBe('computed');await expect(fs.access(path.join(f.root,'out.txt'))).rejects.toBeDefined();expect(await fs.readFile(path.join(f.root,'private.txt'),'utf8')).toBe('PRIVATE_SENTINEL');
 }finally{delete process.env.CBIM_SCOPED_SECRET;await f.close()}
},30000);
