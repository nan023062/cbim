import {test,expect} from 'vitest';
import {sessionRuns,SessionTaskView} from '../src/frontend/tasks/SessionTaskView';
import type {RunSummary} from '../src/backend/core/brain/types';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const run=(taskId:string,workspaceId='w'):RunSummary=>({task:{taskId,workspaceId,root:'root',goal:taskId,moduleIds:[],acceptance:[]},runId:taskId,status:'completed',acceptance:'not_evaluated',unresolvedTools:[],events:[]});
test('root details distinguish delivery candidate from acceptance and show recorded steps only when selected',()=>{
 const item=run('current');item.taskProgress={version:3,goal:'交付示例',reason:'新增要求',acceptance:['验证可运行'],state:'awaiting_review',steps:[{id:'one',title:'实现及验证',owner:'主 Agent',state:'reported_done',evidence:['receipt-id']}],delivery:{summary:'已准备候选',limitations:['触屏未验证']}};
 const props={workspaceId:'w',taskId:'current',runs:[item],queued:[],now:0,busy:false,onQueueChange:()=>{},onQueueContinue:()=>{},onChat:()=>{},onStop:()=>{}};
 const defaultHtml=renderToStaticMarkup(createElement(SessionTaskView,props));expect(defaultHtml).toContain('dispatch-root-node');expect(defaultHtml).not.toContain('receipt-id');expect(defaultHtml).not.toContain('root-task-detail');expect(defaultHtml).not.toContain('dispatch-task-node');
 const html=renderToStaticMarkup(createElement(SessionTaskView,{...props,selectedTaskId:'session:current',onSelectTask:()=>{}}));
 expect(html).toContain('交付待审阅');expect(html).toContain('尚未业务验收');expect(html).toContain('receipt-id');expect(html).toContain('触屏未验证');
});
test('session task view isolates both workspace and conversation, including queued messages',()=>{
 const runs=[run('current'),run('other'),run('current','other-workspace')];expect(sessionRuns(runs,'w','current')).toEqual([runs[0]]);expect(sessionRuns(runs,'w')).toEqual([]);
 const html=renderToStaticMarkup(createElement(SessionTaskView,{workspaceId:'w',taskId:'current',runs,queued:[{id:'q',taskId:'other',message:'OTHER_QUEUE_SENTINEL',status:'pending',options:{model:'m',provider:'p'}}],now:0,busy:false,onQueueChange:()=>{},onQueueContinue:()=>{},onChat:()=>{},onStop:()=>{}}));
 expect(html).toContain('1 次执行');expect(html).not.toContain('OTHER_QUEUE_SENTINEL');expect(html).not.toContain('other-workspace');
});

test('主根详情展示已记录的实例与对话通道，旧日志不按主角色推断身份',()=>{
 const item=run('current');item.task.mode='chat';item.task.agentId='cbim:main';
 const props={workspaceId:'w',taskId:'current',runs:[item],queued:[],now:0,busy:false,selectedTaskId:'session:current',onSelectTask:()=>{},onQueueChange:()=>{},onQueueContinue:()=>{},onChat:()=>{},onStop:()=>{}};
 const legacy=renderToStaticMarkup(createElement(SessionTaskView,props));expect(legacy).toContain('历史记录未保存主 Agent 实例绑定');
 item.conversationBinding={workspaceId:'w',rootSessionId:'current',teamId:'team',agentId:'cbim:main',agentInstanceId:'main-current',agentSessionId:'chat-current'};
 const html=renderToStaticMarkup(createElement(SessionTaskView,props));expect(html).toContain('main-current');expect(html).toContain('chat-current');expect(html).toContain('主 Agent 负责调度与知识治理');expect(html).toContain('业务任务由独立执行 Agent 实例完成');expect(html).not.toContain('历史记录未保存');expect(html).not.toContain('自执行');
 const foreign={...item,conversationBinding:{...item.conversationBinding,rootSessionId:'other'}};
 const rejected=renderToStaticMarkup(createElement(SessionTaskView,{...props,runs:[foreign]}));expect(rejected).toContain('实例身份不一致');expect(rejected).not.toContain('chat-current');
});
