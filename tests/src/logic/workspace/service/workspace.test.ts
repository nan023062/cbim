// logic/workspace/service: module-owned integration coverage; keep the original scenario and cleanup semantics.
import {describe,it,expect} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fixture} from '../../application/support/helpers';
import {request,moduleFiles} from '../../knowledge/rules/data/knowledge';
import {internalKnowledge} from '../../tools/runtime/support/knowledge-tool-fixture';
import {exists,readJson} from '../../../../../src/core/io/text-files';
import {json} from '../../../../../src/core/io/serialization';
import {Workspace} from '../../../../../src/logic/workspace/service/workspace';
import {KernelLock} from '../../../../../src/core/io/locking';
import {spawn} from 'node:child_process';
import {once} from 'node:events';

describe('真实工作区与内部知识服务',()=>{
  it('首次打开创建空 Team 与 workspace 骨架，不创建全局 Workflow 或示例节点',async()=>{const f=await fixture();try{
    const entry=await f.app.catalog.Add(f.a);expect(await exists(path.join(f.a,'.cbim'))).toBe(false);
    const w=await f.app.Open(entry.id),root=path.join(f.a,'.cbim');
    expect((await fs.readdir(root)).sort()).toEqual(['README.md','connectors','project.json','team','workspace']);
    expect((await fs.readdir(path.join(root,'team'))).sort()).toEqual(['registry.json','skills','skills.json']);
    expect(await fs.readdir(path.join(root,'team/skills'))).toEqual([]);
    expect(await fs.readdir(path.join(root,'workspace'))).toEqual(['registry.json']);
    expect(await fs.readdir(path.join(root,'connectors'))).toEqual(['registry.json']);
    for(const [file,value] of Object.entries({'project.json':{formatVersion:1,rulesVersion:1},'team/registry.json':{groups:[]},'team/skills.json':{skills:[]},'workspace/registry.json':{modules:[]},'connectors/registry.json':{connectors:[]}}))expect(await readJson(path.join(root,file))).toEqual(value);
    expect((await w.Snapshot()).validation?.structural).toBe(true);
    expect(await exists(path.join(root,'entry.md'))).toBe(false);
    expect((await w.Read()).files.some(f=>f.path==='.cbim/entry.md')).toBe(false);
    expect((await fs.readdir(f.a)).some(x=>x.startsWith('.cbim-init-'))).toBe(false);
    const original=await w.Read();await f.app.Stop(entry.id);const reopened=await f.app.Open(entry.id);
    expect((await reopened.Read()).revision).toBe(original.revision);
    expect(reopened.instanceId).not.toBe(w.instanceId);
    const {call}=internalKnowledge(reopened);
    await expect(call('cbim_knowledge_snapshot',{instanceId:w.instanceId})).rejects.toMatchObject({code:'STALE_INSTANCE',message:expect.stringContaining(reopened.instanceId)});
    const identity=await call('cbim_workspace_identity');expect(identity.instanceId).toBe(reopened.instanceId);
    expect((await call('cbim_knowledge_snapshot',{instanceId:identity.instanceId})).revision).toBe(original.revision);
  }finally{await f.cleanup()}});
  it('目录别名与跨进程工程互斥',async()=>{const f=await fixture();try{const alias=path.join(f.temp,'alias');await fs.symlink(f.a,alias,'junction');const e=await f.app.catalog.Add(f.a);expect((await f.app.catalog.Add(alias)).id).toBe(e.id);const w=await f.app.Open(e.id);expect(()=>new KernelLock(f.a,e.id)).toThrow();
    if(process.platform==='win32'){const script=`const k=require('koffi');const w=k.load('kernel32.dll');const c=w.func('void * __stdcall CreateMutexW(void *, int, str16)');const wait=w.func('uint32 __stdcall WaitForSingleObject(void *, uint32)');const h=c(null,0,${JSON.stringify('Global\\CBIM_project_'+e.id)});process.exit(h&&[0,128].includes(wait(h,0))?9:0);`;const child=spawn(process.execPath,['-e',script],{windowsHide:true});const [code]=await once(child,'exit');expect(code).toBe(0)}await w.Close();
  }finally{await f.cleanup()}});
  it('缓存损坏可添加、并发合并、重新定位保留旧历史',async()=>{const f=await fixture();try{await fs.writeFile(path.join(f.user,'workspaces.json'),'broken');await Promise.all([f.app.catalog.Add(f.a),f.app.catalog.Add(f.b)]);expect((await f.app.catalog.Read()).entries).toHaveLength(2);const e=await f.app.catalog.Add(f.a);await f.app.Open(e.id);await f.app.Stop(e.id);const next=path.join(f.temp,'moved');await fs.rename(f.a,next);const relocated=await f.app.catalog.Relocate(e.id,next,true);expect(relocated.id).not.toBe(e.id);expect((await f.app.catalog.Read()).entries.find(x=>x.id===relocated.id)?.previousIds).toContain(e.id);expect(await exists(f.app.paths.Project(e.id))).toBe(true)}finally{await f.cleanup()}});
});
