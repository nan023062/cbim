import {it,expect} from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {ArtifactFiles,normalizeArtifactPath,artifactFileLimits} from '../src/backend/main/platform/files/artifact-files';

async function fixture(){const root=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-artifacts-'));let alive=true;const files=new ArtifactFiles(root,()=>{if(!alive)throw Error('工作区已退役')});return {root,files,retire:()=>{alive=false},cleanup:async()=>{const target=path.resolve(root);if(path.dirname(target)!==path.resolve(os.tmpdir())||!path.basename(target).startsWith('cbim-artifacts-'))throw Error('Unexpected cleanup');await fs.rm(target,{recursive:true,force:true})}}}
it('hashes actual binary bytes and preserves path case; explicit comparison detects changed and missing without writing',async()=>{
  const f=await fixture();try{
    const original=Buffer.from([0,255,128,13,10]);await fs.writeFile(path.join(f.root,'Artifact.BIN'),original);const signal=new AbortController().signal;
    const baseline=await f.files.captureFiles(['Artifact.BIN'],signal);expect(baseline).toEqual([{relativePath:'Artifact.BIN',byteLength:5,sha256:createHash('sha256').update(original).digest('hex')}]);
    expect(normalizeArtifactPath(f.root,path.join(f.root,'Artifact.BIN'))).toBe('Artifact.BIN');
    expect((await f.files.checkFiles(baseline,signal))[0].state).toBe('matches');await fs.writeFile(path.join(f.root,'Artifact.BIN'),'new');expect((await f.files.checkFiles(baseline,signal))[0].state).toBe('changed');
    await fs.unlink(path.join(f.root,'Artifact.BIN'));expect((await f.files.checkFiles(baseline,signal))[0]).toMatchObject({state:'missing',expected:{byteLength:5}});
  }finally{await f.cleanup()}
});
it('rejects directories, traversal, knowledge paths, devices, ADS and aliases rather than hashing a permissive path',async()=>{
  const f=await fixture();try{
    await fs.mkdir(path.join(f.root,'src'));await fs.mkdir(path.join(f.root,'.cbim'));await fs.writeFile(path.join(f.root,'actual.txt'),'file');
    const signal=new AbortController().signal;
    for(const target of ['src','.cbim/file','../outside.txt','C:\\outside','//server/share/file','actual.txt:secret','NUL','\\\\?\\C:\\file'])await expect(f.files.captureFiles([target],signal)).rejects.toBeTruthy();
    const alias=path.join(f.root,'alias');await fs.symlink(path.join(f.root,'src'),alias,'junction');await expect(f.files.captureFiles(['alias/file'],signal)).rejects.toMatchObject({code:'ARTIFACT_PATH'});
    await fs.link(path.join(f.root,'actual.txt'),path.join(f.root,'hard.txt'));await expect(f.files.captureFiles(['hard.txt'],signal)).rejects.toMatchObject({code:'ARTIFACT_PATH'});
  }finally{await f.cleanup()}
});
it('enforces per-file and shared comparison byte bounds without producing truncated matching hashes',async()=>{
  const f=await fixture();try{
    const signal=new AbortController().signal,small=Buffer.alloc(artifactFileLimits.bytesPerFile,42);
    await fs.writeFile(path.join(f.root,'too-large'),Buffer.alloc(artifactFileLimits.bytesPerFile+1));await expect(f.files.captureFiles(['too-large'],signal)).rejects.toMatchObject({code:'ARTIFACT_LIMIT'});
    for(let i=0;i<5;i++)await fs.writeFile(path.join(f.root,'file-'+i),small);
    const paths=Array.from({length:5},(_,i)=>'file-'+i);await expect(f.files.captureFiles(paths,signal)).rejects.toMatchObject({code:'ARTIFACT_LIMIT'});
    const expected=paths.map(relativePath=>({relativePath,byteLength:small.length,sha256:createHash('sha256').update(small).digest('hex')}));
    expect((await f.files.checkFiles(expected,signal)).map(file=>file.state)).toEqual(['matches','matches','matches','matches','unverifiable']);
  }finally{await f.cleanup()}
});
it('stopping or retiring the owner refuses capture; reads do not continue through stale ownership',async()=>{
  const f=await fixture();try{
    await fs.writeFile(path.join(f.root,'file'),'value');const controller=new AbortController();controller.abort(Error('已停止'));
    await expect(f.files.captureFiles(['file'],controller.signal)).rejects.toThrow('已停止');f.retire();await expect(f.files.captureFiles(['file'],new AbortController().signal)).rejects.toThrow('退役');
  }finally{await f.cleanup()}
});

it('观察没有成功基线的当前文件，零字节/缺失/超限各保留真实事实',async()=>{
  const f=await fixture();try{
    const signal=new AbortController().signal;await fs.writeFile(path.join(f.root,'empty'),'');await fs.writeFile(path.join(f.root,'large'),Buffer.alloc(artifactFileLimits.bytesPerFile+1));
    const observed=await f.files.observeFiles(['empty','missing','large'],signal);
    expect(observed[0]).toEqual({relativePath:'empty',state:'present',byteLength:0,sha256:createHash('sha256').update('').digest('hex')});expect(observed[1]).toMatchObject({relativePath:'missing',state:'missing'});expect(observed[2]).toMatchObject({relativePath:'large',state:'unverifiable'});expect(observed[2]).not.toHaveProperty('sha256');
    expect(observed.every(file=>!('baselineId'in file)&&!('content'in file))).toBe(true);
    await fs.writeFile(path.join(f.root,'empty'),'changed');expect((await f.files.observeFiles(['empty'],signal))[0]).toMatchObject({state:'present',byteLength:7});
    await expect(f.files.observeFiles(['../outside'],signal)).rejects.toBeTruthy();const stopped=new AbortController();stopped.abort(Error('stop observation'));await expect(f.files.observeFiles(['empty'],stopped.signal)).rejects.toThrow('stop observation');
  }finally{await f.cleanup()}
});
