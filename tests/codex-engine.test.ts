import {expect,test} from 'vitest';
import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {CodexEngine,codexEnvironment} from '../src/backend/core/brain/codex/engine';
import {codexFixture} from './codex-fixture';

test('real Codex streams text, binds its actual thread ID and resumes the same file',async()=>{
  const f=await codexFixture();let resumed:CodexEngine|undefined;
  try{
    await f.engine.start(f.context);expect(await f.engine.run('Remember the original input')).toEqual({status:'completed'});await f.engine.close();
    const bound=f.events.filter(event=>event.type==='session.bound'&&event.data.sessionFile).at(-1)!.data;expect(bound.sessionId).not.toBe(f.context.task.taskId);expect(await fs.readFile(String(bound.sessionFile),'utf8')).toContain('CBIM Codex OK');
    expect(f.events.some(event=>event.type==='message.delta')).toBe(true);expect(f.events.some(event=>event.type==='message'&&event.data.text==='CBIM Codex OK')).toBe(true);
    expect(f.events.find(event=>event.data.metric==='run-usage')?.data.tokens).toEqual({input:100,output:20,cacheRead:0,cacheWrite:0});
    const original=await fs.readFile(String(bound.sessionFile));let resumeChecks=0;
    resumed=new CodexEngine(f.engineOptions);await resumed.start({...f.context,runId:randomUUID(),sessionFile:String(bound.sessionFile),nativeSessionId:String(bound.sessionId),assertMemberResume:async()=>{resumeChecks++;expect((await fs.readFile(String(bound.sessionFile))).equals(original),'完整检查点复核必须发生在原生恢复追加设置之前').toBe(true)}});expect(resumeChecks).toBe(2);
    const restored=await fs.readFile(String(bound.sessionFile));expect(restored.subarray(0,original.length).equals(original)).toBe(true);expect(restored.subarray(original.length).toString('utf8')).toContain('thread_settings_applied');expect(await resumed.run('Continue')).toEqual({status:'completed'});
    expect(f.requests).toHaveLength(2);expect(f.requests.every(request=>request.body.model===f.llm.profile.model&&request.body.max_output_tokens===4096)).toBe(true);expect(JSON.stringify(f.requests[1].body)).toContain('Remember the original input');expect(f.errors).toEqual([]);expect(JSON.stringify(f.events)).not.toContain(f.llm.apiKey);
    expect(f.events.filter(event=>event.data.metric==='run-usage').map(event=>event.data.tokens)).toEqual([{input:100,output:20,cacheRead:0,cacheWrite:0},{input:100,output:20,cacheRead:0,cacheWrite:0}]);
  }finally{await resumed?.close();await f.cleanup()}
},60000);

test('Codex environment uses its private home and never inherits another client account',()=>{
  const prior=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY='not-this-account';try{const env=codexEnvironment('private-home','proxy-token');expect(env.OPENAI_API_KEY).toBeUndefined();expect(env.CODEX_HOME).toBe('private-home');expect(env.CBIM_CODEX_API_KEY).toBe('proxy-token')}finally{if(prior===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=prior}
});
