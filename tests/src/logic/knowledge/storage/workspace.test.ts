// logic/knowledge/storage: module-owned integration coverage; keep the original scenario and cleanup semantics.
import {describe,it,expect} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fixture} from '../../application/support/helpers';
import {request,moduleFiles} from '../rules/data/knowledge';
import {internalKnowledge} from '../../tools/runtime/support/knowledge-tool-fixture';
import {exists,readJson} from '../../../../../src/core/io/text-files';
import {json} from '../../../../../src/core/io/serialization';
import {Workspace} from '../../../../../src/logic/workspace/service/workspace';
import {KernelLock} from '../../../../../src/core/io/locking';
import {spawn} from 'node:child_process';
import {once} from 'node:events';

describe('真实工作区与内部知识服务',()=>{
  it('过期写入、幂等重试、路径越界与链接拒绝',async()=>{const f=await fixture();try{const e=await f.app.catalog.Add(f.a);const w=await f.app.Open(e.id);const snap=await w.Read();const r=request(snap,[{path:'.cbim/README.md',text:'# new'}]);const first=await w.Commit(r);expect(await w.Commit(r)).toEqual(first);
    await expect(w.Commit(request(snap,[{path:'.cbim/README.md',text:'# stale'}]))).rejects.toThrow(/外部修改/);
    await expect(w.Preview(request(await w.Read(),[{path:'.cbim/../outside.md',text:'bad'}]))).rejects.toThrow();
    const latest=await w.Read();await fs.writeFile(path.join(f.a,'.cbim/README.md'),'# human');await expect(w.Commit(request(latest,[{path:'.cbim/README.md',text:'# override'}]))).rejects.toThrow();
    await fs.symlink(f.b,path.join(f.a,'.cbim/workspace/escape'),'junction');await expect(w.Read()).rejects.toThrow(/链接/);await fs.unlink(path.join(f.a,'.cbim/workspace/escape'));
  }finally{await f.cleanup()}});
  it('事务中断实际回滚；崩溃残留下次打开恢复',async()=>{const f=await fixture();try{const e=await f.app.catalog.Add(f.a);const initial=await f.app.Open(e.id);const old=(await initial.Read()).files.find(x=>x.path==='.cbim/README.md')!.text;await f.app.Stop(e.id);
    const broken=new Workspace(e,f.app.paths,f.app.rules,n=>{if(n===1)throw Error('simulated disk failure')});await broken.Open();
    await expect(broken.Commit(request(await broken.Read(),[{path:'.cbim/README.md',text:'# partial'},{path:'.cbim/extra.md',text:'# extra'}]))).rejects.toThrow('simulated');expect(await fs.readFile(path.join(f.a,'.cbim/README.md'),'utf8')).toBe(old);await broken.Close();
    const dir=f.app.paths.Local(e.id,'transactions');await fs.writeFile(path.join(f.a,'.cbim/README.md'),'# crash');await fs.writeFile(path.join(dir,'crash-test.json'),json({version:1,workspaceId:e.id,requestId:'crash-test',fingerprint:'x',state:'committing',before:{'.cbim/README.md':old},after:{'.cbim/README.md':'# crash'}}));
    const restored=await f.app.Open(e.id);expect((await restored.Read()).files.find(x=>x.path==='.cbim/README.md')?.text).toBe(old);expect((await readJson(path.join(dir,'crash-test.json'))).state).toBe('rolled_back');
  }finally{await f.cleanup()}});
  it('恢复冲突保留人工编辑并拒绝发布服务',async()=>{const f=await fixture();try{const e=await f.app.catalog.Add(f.a);await f.app.Open(e.id);await f.app.Stop(e.id);const dir=f.app.paths.Local(e.id,'transactions');await fs.writeFile(path.join(f.a,'.cbim/README.md'),'# human');await fs.writeFile(path.join(dir,'conflict.json'),json({version:1,workspaceId:e.id,state:'committing',before:{'.cbim/README.md':'# old'},after:{'.cbim/README.md':'# machine'}}));await expect(f.app.Open(e.id)).rejects.toThrow(/冲突/);expect(await fs.readFile(path.join(f.a,'.cbim/README.md'),'utf8')).toBe('# human');expect(await exists(path.join(f.app.paths.Project(e.id),'discovery.json'))).toBe(false)}finally{await f.cleanup()}});
  it('已有知识不覆盖，不兼容版本不发布',async()=>{const f=await fixture();try{const e=await f.app.catalog.Add(f.a);await f.app.Open(e.id);await f.app.Stop(e.id);await fs.writeFile(path.join(f.a,'.cbim/README.md'),'# owned');await f.app.Open(e.id);expect(await fs.readFile(path.join(f.a,'.cbim/README.md'),'utf8')).toBe('# owned');await f.app.Stop(e.id);await fs.writeFile(path.join(f.a,'.cbim/project.json'),json({formatVersion:99,rulesVersion:1}));await expect(f.app.Open(e.id)).rejects.toThrow(/不兼容/);expect(await exists(path.join(f.app.paths.Project(e.id),'discovery.json'))).toBe(false)}finally{await f.cleanup()}});
});
