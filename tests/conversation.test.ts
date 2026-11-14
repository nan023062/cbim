import {expect,test} from 'vitest';
import {transcript,completionFeedback} from '../src/view/execution-view/transcript';
import type {RunSummary,EngineEvent} from '../src/logic/execution/rules/types';
function run(events:EngineEvent[]):RunSummary{return {task:{taskId:'task',workspaceId:'workspace',root:'root',goal:'目标',moduleIds:[],acceptance:['验证']},runId:'run',status:'completed',acceptance:'not_evaluated',unresolvedTools:[],events:events.map((e,i)=>({...e,version:1,seq:i+1,taskId:'task',workspaceId:'workspace',runId:'run',time:'2026-11-06T00:00:00Z'}))}}
test('text deltas are replaced by final text; follow-up user message and tool evidence remain ordered',()=>{
 const messages=transcript(run([{type:'run.started',data:{message:'继续验证'}},{type:'message.delta',data:{text:'早期'}},{type:'message.delta',data:{text:'草稿'}},{type:'message',data:{text:'最终回复'}},{type:'tool.denied',data:{id:'t',name:'write',reason:'未授权'}}]));
 expect(messages.map(m=>m.kind)).toEqual(['user','assistant','tool']);expect(messages[0].text).toBe('继续验证');expect(messages[1].text).toBe('最终回复');expect(messages[1].pending).toBe(false);expect(messages[2].text).toContain('未授权');
});
test('interrupted stream remains visible alongside the actual error',()=>{const messages=transcript(run([{type:'run.started',data:{}},{type:'message.delta',data:{text:'部分结果'}},{type:'run.interrupted',data:{error:'连接断开'}}]));expect(messages.map(m=>m.text)).toEqual(['目标','部分结果','连接断开']);expect(messages[1].pending).toBe(false)});

test('empty terminal message does not erase streamed response or merge a new user turn into it',()=>{
 const r=run([{type:'message.delta',data:{text:'已完成真实回复'}},{type:'message',data:{text:''}},{type:'engine.status',data:{metric:'insertion',state:'accepted',message:'新问题'}},{type:'message.delta',data:{text:'新答复'}}]);
 expect(transcript(r).map(item=>item.text)).toEqual(['目标','已完成真实回复','新问题','新答复']);
 expect(completionFeedback(r,transcript(r))).toBeUndefined();
});

test('tool-only completion has visible honest next steps, not fabricated acceptance or old delivery',()=>{
 const r=run([{type:'tool.finished',data:{id:'one',name:'read'}}]);
 expect(completionFeedback(r,transcript(r))).toContain('未记录 Agent 的最终反馈');
 expect(completionFeedback(r,transcript(r))).toContain('1 项工具操作');
 r.taskProgress={version:1,goal:'old',acceptance:[],steps:[],state:'awaiting_review',reason:'old',delivery:{summary:'旧轮交付不可复用',limitations:[]}};
 expect(completionFeedback(r,transcript(r))).not.toContain('旧轮交付不可复用');
 r.status='running';expect(completionFeedback(r,transcript(r))).toBeUndefined();
 r.status='cancelled';r.unresolvedTools=['one'];expect(completionFeedback(r,transcript(r))).toContain('已停止');expect(completionFeedback(r,transcript(r))).toContain('1 项结果待核实');
});

test('current run delivery summary and limitations remain visible when no final message follows tools',()=>{
 const progress={version:2,goal:'goal',acceptance:[],steps:[],state:'awaiting_review',reason:'',delivery:{summary:'本轮实现完成',limitations:['未做安装验收']}};
 const r=run([{type:'task.updated',data:{progress}},{type:'tool.finished',data:{id:'delivery',name:'cbim_delivery_prepare'}}]);
 const text=completionFeedback(r,transcript(r));expect(text).toContain('本轮实现完成');expect(text).toContain('未做安装验收');expect(text).toContain('尚未代表验收通过');
 const original=JSON.stringify(r);expect(completionFeedback(JSON.parse(original),transcript(r))).toBe(text);expect(JSON.stringify(r)).toBe(original);
});
