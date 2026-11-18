// logic/knowledge/rules: module-owned integration coverage; keep the original scenario and cleanup semantics.
import {describe,it,expect} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fixture} from '../../application/support/helpers';
import {request,moduleFiles} from './data/knowledge';
import {internalKnowledge} from '../../tools/runtime/support/knowledge-tool-fixture';
import {exists,readJson} from '../../../../../src/core/io/text-files';
import {json} from '../../../../../src/core/io/serialization';
import {Workspace} from '../../../../../src/logic/workspace/service/workspace';
import {KernelLock} from '../../../../../src/core/io/locking';
import {spawn} from 'node:child_process';
import {once} from 'node:events';

describe('真实工作区与内部知识服务',()=>{
  it('创建真实模块、派生索引与移动引用',async()=>{const f=await fixture();try{const e=await f.app.catalog.Add(f.a),w=await f.app.Open(e.id);const changes=moduleFiles().map(({path,text})=>({path,text}));const p=await w.Preview(request(await w.Read(),changes));expect(p.validation.issues).toEqual([]);await w.Commit(p.request);expect((await w.Snapshot()).validation?.tree.roots).toEqual(['.cbim/workspace/game']);const move=await w.PlanMove(await w.Read(),'.cbim/workspace/game','.cbim/workspace/resources');expect((await w.Preview(move)).validation.structural).toBe(true);await w.Commit(move);expect((await w.Snapshot()).validation?.tree.roots).toEqual(['.cbim/workspace/resources'])}finally{await f.cleanup()}});
});
