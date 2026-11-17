// project: module-owned integration coverage; keep the original scenario and cleanup semantics.
import {describe,it,expect} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fixture} from '../src/logic/application/unittest/support/helpers';
import {request,moduleFiles} from '../src/logic/knowledge/rules/unittest/data/knowledge';
import {internalKnowledge} from '../src/logic/tools/runtime/unittest/support/knowledge-tool-fixture';
import {exists,readJson} from '../src/core/platform/node/files/index';
import {json} from '../src/core/platform/node/serialization';
import {Workspace} from '../src/logic/workspace/service/workspace';
import {KernelLock} from '../src/core/platform/node/locking';
import {spawn} from 'node:child_process';
import {once} from 'node:events';

describe('真实工作区与内部知识服务',()=>{
  it('空初始化、去重、同名隔离、多工作区请求、关闭与移除',async()=>{const f=await fixture();try{
    const a=await f.app.catalog.Add(f.a),b=await f.app.catalog.Add(f.b);expect(a.id).not.toBe(b.id);expect((await f.app.catalog.Add(path.join(f.a,'.'))).id).toBe(a.id);
    const wa=await f.app.Open(a.id),wb=await f.app.Open(b.id);expect((await f.app.List()).entries).toHaveLength(2);expect((await wa.Snapshot()).validation?.structural).toBe(true);
    const snap=await wa.Read();const result=await wa.Commit(request(snap,[{path:'.cbim/README.md',text:'# A'}]));expect(result.workspaceId).toBe(a.id);expect((await wb.Read()).files.find(x=>x.path==='.cbim/README.md')?.text).not.toBe('# A');
    const task=wb.StartTask('validate');await f.app.Stop(a.id);while(task.state==='running')await new Promise(r=>setTimeout(r,10));expect(task.state).toBe('completed');expect(wb.state).toBe('running');
    await f.app.Remove(a.id);expect(await exists(path.join(f.a,'.cbim/README.md'))).toBe(true);expect(await exists(f.app.paths.Local(a.id,'transactions'))).toBe(true);expect(await exists(path.join(f.a,'.cbim.local'))).toBe(false);expect(await exists(path.join(f.a,'.cbim/discovery.json'))).toBe(false);
  }finally{await f.cleanup()}});
});
