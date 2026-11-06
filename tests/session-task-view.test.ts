import {test,expect} from 'vitest';
import {sessionRuns,SessionTaskView} from '../src/frontend/tasks/SessionTaskView';
import type {RunSummary} from '../src/backend/core/brain/types';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const run=(taskId:string,workspaceId='w'):RunSummary=>({task:{taskId,workspaceId,root:'root',goal:taskId,moduleIds:[],acceptance:[]},runId:taskId,status:'completed',acceptance:'not_evaluated',unresolvedTools:[],events:[]});
test('task view distinguishes delivery candidate from acceptance and shows recorded steps',()=>{
 const item=run('current');item.taskProgress={version:3,goal:'交付示例',reason:'新增要求',acceptance:['验证可运行'],state:'awaiting_review',steps:[{id:'one',title:'实现及验证',owner:'主 Agent',state:'reported_done',evidence:['receipt-id']}],delivery:{summary:'已准备候选',limitations:['触屏未验证']}};
 const html=renderToStaticMarkup(createElement(SessionTaskView,{workspaceId:'w',taskId:'current',runs:[item],queued:[],now:0,busy:false,onQueueChange:()=>{},onQueueContinue:()=>{},onChat:()=>{},onStop:()=>{}}));
 expect(html).toContain('交付待审阅');expect(html).toContain('尚未业务验收');expect(html).toContain('receipt-id');expect(html).toContain('触屏未验证');
});
test('session task view isolates both workspace and conversation, including queued messages',()=>{
 const runs=[run('current'),run('other'),run('current','other-workspace')];expect(sessionRuns(runs,'w','current')).toEqual([runs[0]]);expect(sessionRuns(runs,'w')).toEqual([]);
 const html=renderToStaticMarkup(createElement(SessionTaskView,{workspaceId:'w',taskId:'current',runs,queued:[{id:'q',taskId:'other',message:'OTHER_QUEUE_SENTINEL',status:'pending',options:{model:'m',provider:'p'}}],now:0,busy:false,onQueueChange:()=>{},onQueueContinue:()=>{},onChat:()=>{},onStop:()=>{}}));
 expect(html).toContain('1 次执行');expect(html).not.toContain('OTHER_QUEUE_SENTINEL');expect(html).not.toContain('other-workspace');
});
