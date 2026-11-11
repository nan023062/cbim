import {it,expect} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fixture} from './helpers';
import {request} from './data/knowledge';
import {internalKnowledge} from './knowledge-tool-fixture';
import {exists} from '../src/backend/core/foundation/files';
function child(mode:string,root:string,user:string){return new Promise<{code:number|null;output:string}>((resolve,reject)=>{const p=spawn(process.execPath,['--import','tsx','tests/process-child.ts',mode,root,user],{windowsHide:true});let output='';p.stdout.on('data',x=>output+=x);p.stderr.on('data',x=>output+=x);p.on('error',reject);p.on('exit',code=>resolve({code,output}))})}

it('真正进程终止后恢复事务、释放内核锁和失效旧实例',async()=>{
  const f=await fixture();try{
    const e=await f.app.catalog.add(f.a),w=await f.app.open(e.id);
    const old=(await w.read()).files.find(x=>x.path==='.cbim/README.md')!.text;await f.app.stop(e.id);
    const result=await child('crash',f.a,f.user);expect(result,result.output).toMatchObject({code:88});
    expect(await fs.readFile(path.join(f.a,'.cbim/README.md'),'utf8')).toBe('# interrupted');
    const stale=JSON.parse(result.output.trim().split(/\r?\n/).find(line=>line.startsWith('{"instanceId"'))!);
    const recovered=await f.app.open(e.id);expect(recovered.instanceId).not.toBe(stale.instanceId);
    await expect(internalKnowledge(recovered).call('cbim_knowledge_snapshot',{instanceId:stale.instanceId})).rejects.toMatchObject({code:'STALE_INSTANCE'});
    expect(await fs.readFile(path.join(f.a,'.cbim/README.md'),'utf8')).toBe(old);expect(await exists(path.join(f.a,'.cbim/new.md'))).toBe(false);
  }finally{await f.cleanup()}
});
it('跨进程工作区缓存更新合并',async()=>{const f=await fixture();try{const results=await Promise.all([child('catalog',f.a,f.user),child('catalog',f.b,f.user)]);for(const result of results)expect(result,result.output).toMatchObject({code:0});expect((await f.app.catalog.read()).entries).toHaveLength(2)}finally{await f.cleanup()}});
it('内部知识服务隔离两个工作区，拒绝跨工作区身份和错误实例',async()=>{
  const f=await fixture();try{
    const a=await f.app.dispatch('add',{path:f.a}),b=await f.app.dispatch('add',{path:f.b});
    const ca=internalKnowledge(f.app.workspace(a.id)),cb=internalKnowledge(f.app.workspace(b.id));
    expect((await ca.call('cbim_workspace_identity')).workspaceId).not.toBe((await cb.call('cbim_workspace_identity')).workspaceId);
    await expect(ca.call('cbim_knowledge_snapshot',cb.identity)).rejects.toThrow();
    await expect(cb.call('cbim_knowledge_snapshot',{instanceId:ca.identity.instanceId})).rejects.toMatchObject({code:'STALE_INSTANCE'});
  }finally{await f.cleanup()}
});
it('关闭等待已开始提交，不污染另一个工作区',async()=>{const f=await fixture();try{const a=await f.app.catalog.add(f.a),b=await f.app.catalog.add(f.b),wa=await f.app.open(a.id),wb=await f.app.open(b.id);const s=await wa.read();let started=false;const original=wa.rules.validate.bind(wa.rules);wa.rules.validate=async(...args)=>{started=true;await new Promise(r=>setTimeout(r,30));return original(...args)};const pending=wa.commit(request(s,[{path:'.cbim/README.md',text:'# durable'}]));while(!started)await new Promise(r=>setTimeout(r,1));await f.app.stop(a.id);expect((await pending).state).toBe('committed');expect(await fs.readFile(path.join(f.a,'.cbim/README.md'),'utf8')).toBe('# durable');expect(wb.state).toBe('running')}finally{await f.cleanup()}});
it('未登记与丢失路径不会因查询而自动创建项目或启动工作区',async()=>{const f=await fixture();try{
  expect((await f.app.list()).entries).toEqual([]);await expect(f.app.open('not-registered')).rejects.toThrow();
  expect(await exists(path.join(f.a,'.cbim'))).toBe(false);await expect(f.app.catalog.add(path.join(f.temp,'missing'))).rejects.toThrow();expect(await exists(path.join(f.temp,'missing'))).toBe(false);
}finally{await f.cleanup()}});
