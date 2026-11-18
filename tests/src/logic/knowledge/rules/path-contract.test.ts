// logic/knowledge/rules: module-owned integration coverage; keep the original scenario and cleanup semantics.
import {it,expect} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fixture} from '../../application/support/helpers';
import {request} from './data/knowledge';
import {Application} from '../../../../../src/bridge/server/application';
import {Paths} from '../../../../../src/logic/workspace/service/paths';
import {exists} from '../../../../../src/core/io/text-files';
it('外部 Schema 错误被定位，其他工作区仍可使用，旧历史只诊断',async()=>{const f=await fixture();try{const a=await f.app.catalog.Add(f.a),b=await f.app.catalog.Add(f.b);const wa=await f.app.Open(a.id),wb=await f.app.Open(b.id);await fs.mkdir(path.join(f.a,'.cbim/workspace/bad'));await fs.writeFile(path.join(f.a,'.cbim/workspace/bad/module.json'),'{}');await fs.mkdir(path.join(f.a,'.cbim.local'));const s=await wa.Snapshot();expect(s.validation?.structural).toBe(false);expect(s.validation?.issues.some(i=>i.path?.endsWith('bad/module.json'))).toBe(true);expect(s.validation?.issues.some(i=>i.code==='legacy_local')).toBe(true);expect((await wb.Snapshot()).validation?.structural).toBe(true)}finally{await f.cleanup()}});
it('删除目标不会用旧磁盘文件掩盖悬空引用',async()=>{const f=await fixture();try{const e=await f.app.catalog.Add(f.a),w=await f.app.Open(e.id);await w.Commit(request(await w.Read(),[{path:'.cbim/target.md',text:'# target'},{path:'.cbim/link.md',text:'[target](target.md)'}]));const p=await w.Preview(request(await w.Read(),[{path:'.cbim/target.md',text:null}]));expect(p.validation.structural).toBe(false);await expect(w.Commit(p.request)).rejects.toThrow(/引用/)}finally{await f.cleanup()}});
it('脚本资源真实存在不误报，缺失资源仍报错，知识删除不回退到磁盘',async()=>{
  const f=await fixture();try{const e=await f.app.Dispatch('add',{path:f.a}),w=f.app.Workspace(e.id);await fs.mkdir(path.join(f.a,'.cbim/team/scripts'),{recursive:true});await fs.writeFile(path.join(f.a,'.cbim/team/scripts/helper.py'),'# resource');await fs.writeFile(path.join(f.a,'.cbim/README.md'),'[script](team/scripts/helper.py)');expect((await w.Snapshot()).validation?.structural).toBe(true);await fs.unlink(path.join(f.a,'.cbim/team/scripts/helper.py'));expect((await w.Snapshot()).validation?.issues.some(i=>i.code==='reference')).toBe(true)}finally{await f.cleanup()}
});
