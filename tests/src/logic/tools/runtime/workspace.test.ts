// logic/tools/runtime: module-owned integration coverage; keep the original scenario and cleanup semantics.
import {describe,it,expect} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fixture} from '../../application/support/helpers';
import {request,moduleFiles} from '../../knowledge/rules/data/knowledge';
import {internalKnowledge} from './support/knowledge-tool-fixture';
import {exists,readJson} from '../../../../../src/core/platform/node/files/index';
import {json} from '../../../../../src/core/platform/node/serialization';
import {Workspace} from '../../../../../src/logic/workspace/service/workspace';
import {KernelLock} from '../../../../../src/core/platform/node/locking';
import {spawn} from 'node:child_process';
import {once} from 'node:events';

describe('真实工作区与内部知识服务',()=>{
  it('内部知识工具校验实例、逐调用读写授权和关闭后的访问',async()=>{const f=await fixture();try{
    const e=await f.app.catalog.Add(f.a),w=await f.app.Open(e.id),{call}=internalKnowledge(w);
    expect((await call('cbim_workspace_identity')).workspaceId).toBe(e.id);
    await expect(call('cbim_knowledge_snapshot',{instanceId:'stale'})).rejects.toMatchObject({code:'STALE_INSTANCE',message:expect.stringContaining('使用新 instanceId')});
    await expect(call('cbim_knowledge_snapshot',{workspaceId:'other'})).rejects.toMatchObject({code:'STALE_INSTANCE',message:expect.stringContaining('工程身份不匹配')});
    const snap=await w.Read(),change=request(snap,[{path:'.cbim/README.md',text:'# written'}]);
    await expect(call('cbim_knowledge_commit',change)).rejects.toMatchObject({code:'FORBIDDEN'});
    expect((await call('cbim_knowledge_commit',change,true)).state).toBe('committed');
    await expect(call('cbim_knowledge_commit',change)).rejects.toMatchObject({code:'FORBIDDEN'});
    await f.app.Stop(e.id);await expect(call('cbim_knowledge_snapshot')).rejects.toThrow();
  }finally{await f.cleanup()}});
});
