import {expect,test} from 'vitest';
import {selectEngineSession} from '../src/backend/core/execution/engine-session';
import type {RunSummary} from '../src/backend/core/execution/types';

function summary(id:string,engine:string,resumeFrom?:string):RunSummary{return {runId:id,task:{taskId:'task',workspaceId:'workspace',root:'project',goal:'goal',moduleIds:[],acceptance:[]},status:'completed',acceptance:'not_evaluated',unresolvedTools:[],sessionFile:engine+'/'+id,events:[{type:'run.started',data:{engine,resumeFrom,message:id},version:1,seq:1,taskId:'task',runId:id,workspaceId:'workspace',time:'2026-11-10T00:00:00Z'}]}}
test('same engine restores its own file without replaying public context',async()=>{const old=summary('one','pi');expect(await selectEngineSession('pi',old,async()=>{throw Error('unexpected')})).toEqual({sessionFile:'pi/one'})});
test('first engine switch starts a new native file and transfers ordered public context',async()=>{const one=summary('one','pi'),two=summary('two','pi','one');const result=await selectEngineSession('claude-code',two,async()=>one);expect(result.sessionFile).toBeUndefined();expect(JSON.parse(result.handoff!).map((r:any)=>r.input)).toEqual(['one','two'])});
test('switching back uses the original engine file and only intervening turns',async()=>{const one=summary('one','pi'),two=summary('two','claude-code','one');const result=await selectEngineSession('pi',two,async()=>one);expect(result.sessionFile).toBe('pi/one');expect(JSON.parse(result.handoff!)).toHaveLength(1)});
test('Codex 恢复从目标引擎文件对应的回执取 native ID，不沿用上一引擎身份',async()=>{
  const one=summary('one','codex'),two=summary('two','claude-code','one');one.events.push({...one.events[0],seq:2,type:'session.bound',data:{sessionId:'actual-codex-thread',sessionFile:one.sessionFile}});
  two.events.push({...two.events[0],seq:2,type:'session.bound',data:{sessionId:'claude-thread',sessionFile:two.sessionFile}});
  expect(await selectEngineSession('codex',two,async()=>one)).toMatchObject({sessionFile:one.sessionFile,nativeSessionId:'actual-codex-thread'});
});
test('corrupt, unresolved and cyclic histories are rejected, not silently truncated',async()=>{
  const old=summary('one','pi','one');await expect(selectEngineSession('claude-code',old,async()=>old)).rejects.toThrow('历史链');
  await expect(selectEngineSession('claude-code',{...old,unresolvedTools:['pending']},async()=>old)).rejects.toThrow('核实');
  await expect(selectEngineSession('claude-code',{...old,logIntegrity:{partialTail:true}},async()=>old)).rejects.toThrow('核实');
});

test.each(['completed','partial-tail','assistant-output','tool-call','not-settled','fresh-context'] as const)('缺少原生文件不能对 %s 的运行降级新建上下文',async mode=>{
  const old=summary('one','codex');old.sessionFile=undefined;old.task={...old.task,mode:'chat',agentId:'cbim:main'};old.status='interrupted';old.logIntegrity={partialTail:false};
  old.events.push({...old.events[0],seq:2,type:'run.interrupted',data:{error:'provider failed'}});
  if(mode==='completed'){old.status='completed';old.events[1]={...old.events[1],type:'run.settled',data:{status:'completed'}}}
  else if(mode==='partial-tail')old.logIntegrity.partialTail=true;
  else if(mode==='not-settled')old.events.pop();
  else if(mode==='fresh-context')old.events[0].data.freshMain={nativeSessionId:'registered',excludedRunIds:[]};
  else old.events.splice(1,0,{...old.events[0],seq:2,type:mode==='tool-call'?'tool.proposed':'message.delta',data:{text:'partial output'}});
  await expect(selectEngineSession('pi',old,async()=>{throw Error('Unexpected history read')})).rejects.toThrow();
});

test.each(['pi','codex'])('最新绑定与文件不一致时不能靠更早匹配记录恢复或切换到 %s',async engine=>{
  const old=summary('one','pi');
  old.events.push({...old.events[0],seq:2,type:'session.bound',data:{sessionId:'thread-one',sessionFile:old.sessionFile}});
  old.events.push({...old.events[0],seq:3,type:'session.bound',data:{sessionId:'thread-foreign',sessionFile:'foreign/file'}});
  await expect(selectEngineSession(engine,old,async()=>{throw Error('Unexpected history read')})).rejects.toThrow('身份记录与恢复文件不一致');
});
