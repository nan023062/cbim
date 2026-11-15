import {expect,it} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ChatMessages} from '../src/view/conversation/ChatMessages';
import type {RunSummary} from '../src/bridge/contracts/execution';
function messages():RunSummary[]{
 const run:RunSummary={task:{workspaceId:'workspace',taskId:'root',root:'C:/fixture',goal:'实现网页版中国象棋',moduleIds:[],acceptance:[],mode:'chat'},runId:'run',status:'completed',acceptance:'not_evaluated',unresolvedTools:[],events:[]};
 const add=(value:RunSummary,type:RunSummary['events'][number]['type'],data:Record<string,unknown>)=>value.events.push({version:1,workspaceId:'workspace',taskId:'root',runId:value.runId,seq:value.events.length+1,time:'2026-11-14T00:00:00Z',type,data});
 add(run,'run.started',{message:'实现网页版中国象棋'});add(run,'message',{text:'开始分析'});add(run,'tool.started',{id:'tool',name:'read',input:{path:'file'}});add(run,'tool.finished',{id:'tool',result:'原命令'});add(run,'message',{text:'分析结果'});
 const feedback:RunSummary={...run,runId:'feedback',source:{kind:'member-results',continuationId:'continue',messageIds:['message'],taskIds:['task']},events:[]};add(feedback,'run.started',{source:feedback.source,message:'内部转交，不是用户消息'});add(feedback,'message',{text:'已收到成果'});return [run,feedback];
}

it('聊天保留用户和主 Agent 文字，工具/系统交接不挂载执行详情',()=>{
 const [run,feedback]=messages(),original=JSON.stringify(run);
 const render=(value:typeof run)=>renderToStaticMarkup(createElement(ChatMessages,{run:value,workspaceId:value.task.workspaceId}));
 const html=render(run);expect(html).toContain('实现网页版中国象棋');expect(html).toContain('chat-text');expect(html).not.toContain('data-tool-call-id');expect(html).not.toContain('work-status');expect(html).not.toContain('inline-handoff');expect(html).not.toContain('原命令');
 expect(render(feedback)).not.toContain('data-source-kind="system"');expect(JSON.stringify(run)).toBe(original);
});
it('缺少最终回复不冒充模型输出，保留运行记录提示',()=>{
 const run=messages()[0];run.events=[run.events[0]];run.status='completed';
 const html=renderToStaticMarkup(createElement(ChatMessages,{run,workspaceId:run.task.workspaceId}));expect(html).toContain('运行记录提示');expect(html).toContain('未记录 Agent 的最终反馈');
});
