import {test,expect} from 'vitest';
import {sessionRuns,SessionTaskView} from '../src/frontend/tasks/SessionTaskView';
import type {RunSummary} from '../src/backend/core/brain/types';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const run=(taskId:string,workspaceId='w'):RunSummary=>({task:{taskId,workspaceId,root:'root',goal:taskId,moduleIds:[],acceptance:[]},runId:taskId,status:'completed',acceptance:'not_evaluated',unresolvedTools:[],events:[]});
test('session task view isolates both workspace and conversation, including queued messages',()=>{
 const runs=[run('current'),run('other'),run('current','other-workspace')];expect(sessionRuns(runs,'w','current')).toEqual([runs[0]]);expect(sessionRuns(runs,'w')).toEqual([]);
 const html=renderToStaticMarkup(createElement(SessionTaskView,{workspaceId:'w',taskId:'current',runs,queued:[{id:'q',taskId:'other',message:'OTHER_QUEUE_SENTINEL',status:'pending',options:{model:'m',provider:'p'}}],now:0,busy:false,onQueueChange:()=>{},onQueueContinue:()=>{},onChat:()=>{},onStop:()=>{}}));
 expect(html).toContain('1 次执行');expect(html).not.toContain('OTHER_QUEUE_SENTINEL');expect(html).not.toContain('other-workspace');
});
