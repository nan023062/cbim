import {expect,test,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {CodexEngine} from '../src/backend/engines/codex/engine';
import {readCodexSession} from '../src/backend/engines/codex/session';
import {codexFixture} from './codex-fixture';
import {fixture} from './helpers';

test.each(['incomplete','hold'] as const)('工具完成后 %s：关闭前补登记，原线程可续接且不重放工具',async afterTool=>{
  const f=await codexFixture({tool:'internal',afterTool});let resumed:CodexEngine|undefined;
  try{
    await f.engine.start(f.context);
    const running=f.engine.run('Read once, then wait').catch((error:Error)=>({status:'failed',error:error.message}));
    await vi.waitFor(()=>expect(f.requests).toHaveLength(2));
    if(afterTool==='hold')await f.engine.stop();
    const result=await running;
    expect(result).toEqual(afterTool==='hold'?{status:'cancelled'}:{status:'failed',error:'请求未完整完成'});
    await f.engine.close();
    const bound=f.events.filter(event=>event.type==='session.bound'&&event.data.sessionFile);
    expect(bound).toHaveLength(1);expect(f.invocations).toHaveLength(1);
    const {sessionFile,sessionId}=bound[0].data;
    await readCodexSession(f.home,String(sessionFile),String(sessionId),f.cwd);
    const eventCount=f.events.length;await f.engine.close();expect(f.events).toHaveLength(eventCount);
    resumed=new CodexEngine(f.engineOptions);
    await resumed.start({...f.context,runId:randomUUID(),sessionFile:String(sessionFile),nativeSessionId:String(sessionId)});
    expect(await resumed.run('Continue without repeating the tool')).toEqual({status:'completed'});
    await resumed.close();expect(f.invocations).toHaveLength(1);expect(f.requests).toHaveLength(3);expect(f.errors).toEqual([]);
  }finally{await resumed?.close();await f.cleanup()}
},60000);

test.each(['incomplete','hold'] as const)('真实应用 %s：登记早于日志封存，原会话可继续且旧日志不改写',async afterTool=>{
  const f=await fixture(),provider=await codexFixture({tool:'read',afterTool});
  try{
    const file=path.join(f.a,'sample.txt');await fs.writeFile(file,'read once');
    if('path' in provider.input)provider.input.path=file;
    const settings=await f.app.models.save({profile:{name:'Interrupted provider',api:'openai-responses',auth:'none',baseUrl:provider.llm.profile.baseUrl,defaultModel:'codex-test-model',models:[{id:'codex-test-model',name:'Test',enabled:true,contextWindow:200000,maxTokens:4096,reasoning:false}]}});
    const entry=await f.app.dispatch('add',{path:f.a}),options={engine:'codex',profileId:settings.selectedId!,model:'codex-test-model',permission:'read',turnTimeoutMs:20000};
    const first=await f.app.dispatch('loop.chat',{id:entry.id,message:'Read the sample, then respond',options});
    const read=(runId:string)=>f.app.dispatch('loop.inspect',{id:entry.id,taskId:first.taskId,runId});
    if(afterTool==='hold'){
      await vi.waitFor(()=>expect(provider.requests).toHaveLength(2));
      await f.app.dispatch('loop.stop',{id:entry.id,taskId:first.taskId});
    }
    await vi.waitFor(async()=>{expect((await read(first.runId)).status).toBe(afterTool==='hold'?'cancelled':'interrupted');expect(f.app.runtime.snapshot().pressure.activeRuns).toBe(0)},{timeout:30000});
    const failed=await read(first.runId),before=JSON.stringify(failed.events);
    expect(failed.sessionFile).toBeTruthy();expect(failed.unresolvedTools).toEqual([]);
    expect(failed.events.filter(event=>event.type==='tool.finished')).toHaveLength(1);
    expect(failed.events.find(event=>event.type==='tool.finished')?.data.isError).toBe(false);
    expect(failed.events.at(-1)).toMatchObject(afterTool==='hold'?{type:'run.settled',data:{status:'cancelled'}}:{type:'run.interrupted',data:{error:'请求未完整完成'}});
    const binding=failed.events.findIndex(event=>event.type==='session.bound'&&event.data.sessionFile);
    expect(binding).toBeGreaterThan(0);expect(binding).toBeLessThan(failed.events.length-1);
    const retry=await f.app.dispatch('loop.resume',{id:entry.id,taskId:first.taskId,runId:first.runId,message:'Continue now',options});
    await vi.waitFor(async()=>{expect((await read(retry.runId)).status).toBe('completed');expect(f.app.runtime.snapshot().pressure.activeRuns).toBe(0)},{timeout:30000});
    const done=await read(retry.runId);
    expect(done.sessionFile).toBe(failed.sessionFile);expect(done.conversationBinding).toEqual(failed.conversationBinding);
    expect(done.events.filter(event=>event.type==='tool.finished')).toHaveLength(0);
    expect(JSON.stringify((await read(first.runId)).events)).toBe(before);
    expect(await f.app.dispatch('loop.threadView',{id:entry.id,taskId:first.taskId})).toMatchObject({resumeRunId:retry.runId,issues:[]});
    expect(provider.requests).toHaveLength(3);expect(provider.errors).toEqual([]);
  }finally{await f.cleanup();await provider.cleanup()}
},65000);

test('绑定校验拒绝目录外、身份不符和不完整文件',async()=>{
  const f=await codexFixture(),id=randomUUID();
  try{
    const dir=path.join(f.home,'sessions');await fs.mkdir(dir,{recursive:true});
    const name='rollout-'+id+'.jsonl',outside=path.join(f.root,name),inside=path.join(dir,name);
    const meta=JSON.stringify({type:'session_meta',payload:{id,cwd:f.cwd}})+'\n';
    await fs.writeFile(outside,meta);await expect(readCodexSession(f.home,outside,id,f.cwd)).rejects.toThrow('受管目录');
    await fs.writeFile(inside,meta.replace(id,randomUUID()));await expect(readCodexSession(f.home,inside,id,f.cwd)).rejects.toThrow('身份或工作区');
    await fs.writeFile(inside,meta.trimEnd());await expect(readCodexSession(f.home,inside,id,f.cwd)).rejects.toThrow('尾行不完整');
    await fs.writeFile(inside,meta);expect(await readCodexSession(f.home,inside,id,f.cwd)).toMatchObject({id,cwd:f.cwd});
  }finally{await f.cleanup()}
});
