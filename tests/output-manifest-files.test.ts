import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {OutputManifestFiles} from '../src/backend/main/platform/files/output-manifest-files';
import {artifactScopeSchema,preparedArtifactScopes,type ArtifactScopeBinding} from '../src/backend/core/workspace/artifact-scope';
import {outputManifestSnapshotSchema} from '../src/backend/core/evidence/output-manifest';
import {outputManifestHash} from '../src/backend/core/evidence/output-manifest-evidence';

let root:string,port:OutputManifestFiles;const signal=()=>new AbortController().signal;
const scopes:ArtifactScopeBinding[]=[{moduleId:'module',workflowId:'module/workflow',workflowVersion:'original',scope:{version:1,roots:[{path:'out',kind:'directory'}]}}];
beforeEach(async()=>{root=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-manifest-files-'));await fs.mkdir(path.join(root,'out'));port=new OutputManifestFiles(root,()=>{})});
afterEach(async()=>{vi.restoreAllMocks();assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('cbim-manifest-files-'));await fs.rm(root,{recursive:true,force:true})});

it('真实完整枚举包含根、空目录和文件；旧文件未变时新增条目也改变依据',async()=>{
  await fs.mkdir(path.join(root,'out','empty'));await fs.writeFile(path.join(root,'out','a.txt'),'original');
  const baseline=await port.capture(scopes,signal());expect(baseline.entries.map(v=>[v.relativePath,v.kind])).toEqual([['out','directory'],['out/a.txt','file'],['out/empty','directory']]);
  expect((await port.check(baseline,signal())).state).toBe('matches');
  await fs.writeFile(path.join(root,'out','new.txt'),'new');const added=await port.check(baseline,signal());expect(added.state).toBe('changed');expect(added.observed?.entries.find(v=>v.relativePath==='out/a.txt')).toEqual(baseline.entries[1]);
  await fs.unlink(path.join(root,'out','new.txt'));await fs.rmdir(path.join(root,'out','empty'));expect((await port.check(baseline,signal())).state).toBe('changed');
});
it('删除、移动及根缺失均进入当前集合，不把缺失当空文件或把移动只看新路径',async()=>{
  await fs.writeFile(path.join(root,'out','before.txt'),'bytes');const before=await port.capture(scopes,signal());
  await fs.rename(path.join(root,'out','before.txt'),path.join(root,'out','after.txt'));const moved=await port.check(before,signal());expect(moved.state).toBe('changed');expect(moved.observed?.entries.map(e=>e.relativePath)).toEqual(['out','out/after.txt']);
  await fs.unlink(path.join(root,'out','after.txt'));await fs.rmdir(path.join(root,'out'));const absent=await port.check(before,signal());expect(absent.state).toBe('changed');expect(absent.observed?.roots).toEqual([{relativePath:'out',state:'missing'}]);expect(absent.observed?.entries).toEqual([]);
});
it('文件改字节或类型均使原完整清单失效，无法完整读取不返回局部清单',async()=>{
  await fs.writeFile(path.join(root,'out','one.txt'),'first');const before=await port.capture(scopes,signal());await fs.writeFile(path.join(root,'out','one.txt'),'other');expect((await port.check(before,signal())).state).toBe('changed');
  const fileScopes:ArtifactScopeBinding[]=[{...scopes[0],scope:{version:1,roots:[{path:'out/one.txt',kind:'file'}]}}],file=await port.capture(fileScopes,signal());
  await fs.unlink(path.join(root,'out','one.txt'));await fs.mkdir(path.join(root,'out','one.txt'));const checked=await port.check(file,signal());expect(checked.state).toBe('unverifiable');expect(checked.observed).toBeUndefined();expect(checked.reason).toContain('类型');
});
it('实际链接、硬链接和嵌套受保护目录全部拒绝，不跳过后称完整',async()=>{
  const outside=path.join(root,'other');await fs.mkdir(outside);await fs.writeFile(path.join(outside,'hidden.txt'),'private');
  await fs.symlink(outside,path.join(root,'out','linked'),process.platform==='win32'?'junction':'dir');await expect(port.capture(scopes,signal())).rejects.toThrow();await fs.unlink(path.join(root,'out','linked'));
  await fs.link(path.join(outside,'hidden.txt'),path.join(root,'out','hard.txt'));await expect(port.capture(scopes,signal())).rejects.toThrow();await fs.unlink(path.join(root,'out','hard.txt'));
  await fs.mkdir(path.join(root,'out','.cbim'));await expect(port.capture(scopes,signal())).rejects.toThrow();
});
it('实际枚举数量和单文件大小超过上限立即拒绝',async()=>{
  await Promise.all(Array.from({length:512},(_,i)=>fs.writeFile(path.join(root,'out','f'+i),'x')));await expect(port.capture(scopes,signal())).rejects.toMatchObject({code:'MANIFEST_LIMIT'});
  const handle=await fs.open(path.join(root,'large.bin'),'w');try{await handle.truncate(8*1024*1024+1)}finally{await handle.close()}
  const large=[{...scopes[0],scope:{version:1 as const,roots:[{path:'large.bin',kind:'file' as const}]}}];await expect(port.capture(large,signal())).rejects.toMatchObject({code:'MANIFEST_LIMIT'});
});
it('两次完整观察之间真实文件变化被拒绝，取消也不产出清单',async()=>{
  await fs.writeFile(path.join(root,'out','a.txt'),'before');const original=fs.opendir.bind(fs);let calls=0;
  vi.spyOn(fs,'opendir').mockImplementation(async(...args:Parameters<typeof fs.opendir>)=>{if(++calls===2)await fs.writeFile(path.join(root,'out','a.txt'),'after');return original(...args)});
  await expect(port.capture(scopes,signal())).rejects.toMatchObject({code:'MANIFEST_CHANGED'});
  const abort=new AbortController();abort.abort(Error('stopped'));await expect(port.capture(scopes,abort.signal)).rejects.toThrow('stopped');
});
it('结构拒绝重叠、别名、越界、缺父目录、范围外条目和伪空集合',async()=>{
  for(const value of ['../other','/absolute','x/.cbim/a','x/*.txt','x/con.txt','x:stream','x/..','x/name.'])expect(artifactScopeSchema.safeParse({version:1,roots:[{path:value,kind:'file'}]}).success).toBe(false);
  expect(artifactScopeSchema.safeParse({version:1,roots:[{path:'out',kind:'directory'},{path:'out/a',kind:'file'}]}).success).toBe(false);
  expect(()=>preparedArtifactScopes([{...scopes[0],contract:{artifactScope:scopes[0].scope}},{...scopes[0],moduleId:'other',contract:{artifactScope:{version:1,roots:[{path:'OUT',kind:'file'}]}}}])).toThrow();
  const snapshot=await port.capture(scopes,signal());expect(outputManifestSnapshotSchema.safeParse({...snapshot,entries:[]}).success).toBe(false);
  expect(outputManifestSnapshotSchema.safeParse({...snapshot,entries:[...snapshot.entries,{relativePath:'out/missing/child',kind:'directory'}]}).success).toBe(false);
  expect(outputManifestSnapshotSchema.safeParse({...snapshot,entries:[...snapshot.entries,{relativePath:'outside',kind:'directory'}]}).success).toBe(false);
  expect(outputManifestHash(snapshot)).toMatch(/^[a-f0-9]{64}$/);
});
