import {expect,test} from 'vitest';
import {transcript} from '../src/frontend/execution-view/transcript';
import {readLayouts} from '../src/frontend/shell/tabs';
import type {RunSummary,EngineEvent} from '../src/backend/core/brain/types';
function run(events:EngineEvent[]):RunSummary{return {task:{taskId:'task',workspaceId:'workspace',root:'root',goal:'目标',moduleIds:[],acceptance:['验证']},runId:'run',status:'completed',acceptance:'not_evaluated',unresolvedTools:[],events:events.map((e,i)=>({...e,version:1,seq:i+1,taskId:'task',workspaceId:'workspace',runId:'run',time:'2026-11-06T00:00:00Z'}))}}
test('text deltas are replaced by final text; follow-up user message and tool evidence remain ordered',()=>{
 const messages=transcript(run([{type:'run.started',data:{message:'继续验证'}},{type:'message.delta',data:{text:'早期'}},{type:'message.delta',data:{text:'草稿'}},{type:'message',data:{text:'最终回复'}},{type:'tool.denied',data:{id:'t',name:'write',reason:'未授权'}}]));
 expect(messages.map(m=>m.kind)).toEqual(['user','assistant','tool']);expect(messages[0].text).toBe('继续验证');expect(messages[1].text).toBe('最终回复');expect(messages[1].pending).toBe(false);expect(messages[2].text).toContain('未授权');
});
test('interrupted stream remains visible alongside the actual error',()=>{const messages=transcript(run([{type:'run.started',data:{}},{type:'message.delta',data:{text:'部分结果'}},{type:'run.interrupted',data:{error:'连接断开'}}]));expect(messages.map(m=>m.text)).toEqual(['目标','部分结果','连接断开']);expect(messages[1].pending).toBe(false)});
test('tab binding persists only valid task IDs and remains workspace scoped',()=>{const id='a'.repeat(64),other='b'.repeat(64);const data=readLayouts(JSON.stringify({[id]:{tabs:[{id:'one',kind:'chat',title:'对话',taskId:'task-1',draft:'草稿'}]},[other]:{tabs:[{id:'two',kind:'chat',title:'对话',taskId:'../other'}]}}));expect(data[id].tabs[0].taskId).toBe('task-1');expect(data[other].tabs[0].taskId).toBeUndefined()});
