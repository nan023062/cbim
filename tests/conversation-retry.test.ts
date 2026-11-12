import {expect,it,vi} from 'vitest';
import {fixture} from './helpers';
import {codexFixture} from './codex-fixture';

it.each(['codex','pi'] as const)('真实 Codex 首次 HTTP 400 后可从同一对话显式重发到 %s',async engine=>{
  const f=await fixture(),provider=await codexFixture({failFirst:true});
  try{
    const settings=await f.app.models.save({profile:{name:'Retry provider',api:'openai-responses',auth:'none',baseUrl:provider.llm.profile.baseUrl,defaultModel:'codex-test-model',models:[{id:'codex-test-model',name:'Test',enabled:true,contextWindow:200000,maxTokens:4096,reasoning:false}]}});
    const entry=await f.app.dispatch('add',{path:f.a}),options={profileId:settings.selectedId!,model:'codex-test-model',permission:'read',turnTimeoutMs:20000};
    const first=await f.app.dispatch('loop.chat',{id:entry.id,message:'Keep this original request',options:{...options,engine:'codex'}});
    const read=(runId:string)=>f.app.dispatch('loop.inspect',{id:entry.id,taskId:first.taskId,runId});
    await vi.waitFor(async()=>{expect((await read(first.runId)).status).toBe('interrupted');expect(f.app.runtime.snapshot().pressure.activeRuns).toBe(0)},{timeout:30000,interval:50});
    const failed=await read(first.runId),before=JSON.stringify(failed.events);
    // 异常关闭也会登记已落盘的真实文件；不再把早期线程 ID 当成唯一恢复依据。
    expect(failed.sessionFile).toBeTruthy();expect(provider.requests).toHaveLength(1);
    const view=await f.app.dispatch('loop.threadView',{id:entry.id,taskId:first.taskId});
    expect(view.issues).toEqual([]);expect(view.resumeRunId).toBe(first.runId);
    const retry=await f.app.dispatch('loop.resume',{id:entry.id,taskId:first.taskId,runId:first.runId,message:'Explicitly retry now',options:{...options,engine}});
    await vi.waitFor(async()=>{expect((await read(retry.runId)).status).toBe('completed');expect(f.app.runtime.snapshot().pressure.activeRuns).toBe(0)},{timeout:30000,interval:50});
    const done=await read(retry.runId);
    expect(done.task.taskId).toBe(first.taskId);expect(done.conversationBinding).toEqual(failed.conversationBinding);expect(done.sessionFile).toBeTruthy();
    expect(await f.app.dispatch('loop.threadView',{id:entry.id,taskId:first.taskId})).toMatchObject({issues:[],resumeRunId:retry.runId});
    expect(provider.requests).toHaveLength(2);expect(JSON.stringify(provider.requests[1].body)).toContain('Keep this original request');
    if(engine==='pi')expect(JSON.stringify(provider.requests[1].body)).toContain('已记录的历史输入');
    else expect(done.sessionFile).toBe(failed.sessionFile);
    expect(JSON.stringify((await read(first.runId)).events)).toBe(before);expect(provider.errors).toEqual([]);
  }finally{await f.cleanup();await provider.cleanup()}
},65000);
