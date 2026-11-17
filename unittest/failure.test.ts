// project: module-owned integration coverage; keep the original scenario and cleanup semantics.
import {it,expect} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fixture} from '../src/logic/application/unittest/support/helpers';
import {request} from '../src/logic/knowledge/rules/unittest/data/knowledge';
import {internalKnowledge} from '../src/logic/tools/runtime/unittest/support/knowledge-tool-fixture';
import {exists} from '../src/core/platform/node/files/index';
function child(mode:string,root:string,user:string){return new Promise<{code:number|null;output:string}>((resolve,reject)=>{const p=spawn(process.execPath,['--import','tsx','src/logic/workspace/service/unittest/support/process-child.ts',mode,root,user],{windowsHide:true});let output='';p.stdout.on('data',x=>output+=x);p.stderr.on('data',x=>output+=x);p.on('error',reject);p.on('exit',code=>resolve({code,output}))})}

it('真正进程终止后恢复事务、释放内核锁和失效旧实例',async()=>{
  const f=await fixture();try{
    const e=await f.app.catalog.Add(f.a),w=await f.app.Open(e.id);
    const old=(await w.Read()).files.find(x=>x.path==='.cbim/README.md')!.text;await f.app.Stop(e.id);
    const result=await child('crash',f.a,f.user);expect(result,result.output).toMatchObject({code:88});
    expect(await fs.readFile(path.join(f.a,'.cbim/README.md'),'utf8')).toBe('# interrupted');
    const stale=JSON.parse(result.output.trim().split(/\r?\n/).find(line=>line.startsWith('{"instanceId"'))!);
    const recovered=await f.app.Open(e.id);expect(recovered.instanceId).not.toBe(stale.instanceId);
    await expect(internalKnowledge(recovered).call('cbim_knowledge_snapshot',{instanceId:stale.instanceId})).rejects.toMatchObject({code:'STALE_INSTANCE'});
    expect(await fs.readFile(path.join(f.a,'.cbim/README.md'),'utf8')).toBe(old);expect(await exists(path.join(f.a,'.cbim/new.md'))).toBe(false);
  }finally{await f.cleanup()}
});
it('关闭等待已开始提交，不污染另一个工作区',async()=>{const f=await fixture();try{const a=await f.app.catalog.Add(f.a),b=await f.app.catalog.Add(f.b),wa=await f.app.Open(a.id),wb=await f.app.Open(b.id);const s=await wa.Read();let started=false;const original=wa.rules.Validate.bind(wa.rules);wa.rules.Validate=async(...args)=>{started=true;await new Promise(r=>setTimeout(r,30));return original(...args)};const pending=wa.Commit(request(s,[{path:'.cbim/README.md',text:'# durable'}]));while(!started)await new Promise(r=>setTimeout(r,1));await f.app.Stop(a.id);expect((await pending).state).toBe('committed');expect(await fs.readFile(path.join(f.a,'.cbim/README.md'),'utf8')).toBe('# durable');expect(wb.state).toBe('running')}finally{await f.cleanup()}});
it('未登记与丢失路径不会因查询而自动创建项目或启动工作区',async()=>{const f=await fixture();try{
  expect((await f.app.List()).entries).toEqual([]);await expect(f.app.Open('not-registered')).rejects.toThrow();
  expect(await exists(path.join(f.a,'.cbim'))).toBe(false);await expect(f.app.catalog.Add(path.join(f.temp,'missing'))).rejects.toThrow();expect(await exists(path.join(f.temp,'missing'))).toBe(false);
}finally{await f.cleanup()}});
