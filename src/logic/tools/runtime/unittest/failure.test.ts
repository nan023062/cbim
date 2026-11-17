// logic/tools/runtime: module-owned integration coverage; keep the original scenario and cleanup semantics.
import {it,expect} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fixture} from '../../../application/unittest/support/helpers';
import {request} from '../../../knowledge/rules/unittest/data/knowledge';
import {internalKnowledge} from './support/knowledge-tool-fixture';
import {exists} from '../../../../core/platform/node/files/index';
function child(mode:string,root:string,user:string){return new Promise<{code:number|null;output:string}>((resolve,reject)=>{const p=spawn(process.execPath,['--import','tsx','src/logic/workspace/service/unittest/support/process-child.ts',mode,root,user],{windowsHide:true});let output='';p.stdout.on('data',x=>output+=x);p.stderr.on('data',x=>output+=x);p.on('error',reject);p.on('exit',code=>resolve({code,output}))})}
it('内部知识服务隔离两个工作区，拒绝跨工作区身份和错误实例',async()=>{
  const f=await fixture();try{
    const a=await f.app.Dispatch('add',{path:f.a}),b=await f.app.Dispatch('add',{path:f.b});
    const ca=internalKnowledge(f.app.Workspace(a.id)),cb=internalKnowledge(f.app.Workspace(b.id));
    expect((await ca.call('cbim_workspace_identity')).workspaceId).not.toBe((await cb.call('cbim_workspace_identity')).workspaceId);
    await expect(ca.call('cbim_knowledge_snapshot',cb.identity)).rejects.toThrow();
    await expect(cb.call('cbim_knowledge_snapshot',{instanceId:ca.identity.instanceId})).rejects.toMatchObject({code:'STALE_INSTANCE'});
  }finally{await f.cleanup()}
});
