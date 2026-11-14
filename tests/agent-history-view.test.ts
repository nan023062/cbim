import {expect,test} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import type {AgentHistoryPage,AgentHistoryRun,AgentHistorySession} from '../src/bridge/contracts/agent-history';
import type {RunSummary} from '../src/bridge/contracts/execution';
import {mergeHistoryPage,historyScopeKey,historyRunKey,historyEventScope} from '../src/view/team/agent-history-state';
import {AgentSessionHistory,HistoryRunContent} from '../src/view/team/AgentSessionHistory';

const identity={workspaceId:'workspace',agentId:'cbim:main'};
const record:AgentHistoryRun={...identity,sessionId:'channel',taskId:'task',runId:'run',source:'main',binding:'registered',agentName:'历史主角色',goal:'审阅业务任务',moduleIds:['.cbim/workspace/game'],status:'completed',startedAt:'2026-11-07T10:00:00Z',updatedAt:'2026-11-07T10:01:00Z',agentSessionId:'channel',agentInstanceId:'instance',rootSessionId:'root',configurationRevision:'old-configuration'};
const session:AgentHistorySession={...identity,sessionId:'channel',kind:'conversation',title:'主对话',agentName:'历史主角色',runCount:1,status:'completed',startedAt:record.startedAt,updatedAt:record.updatedAt,agentSessionId:'channel',agentInstanceId:'instance',rootSessionId:'root'};
const page=<T>(items:T[],nextCursor?:string):AgentHistoryPage<T>=>({items,nextCursor,diagnostics:[]});

test('历史分页不按名称合并独立 Session，重叠分页按真实身份去重，刷新替换列表',()=>{
  const previous=page([session],'cursor-one');
  const updated={...session,runCount:2},other={...session,sessionId:'other-channel',agentSessionId:'other-channel',agentInstanceId:'other-instance',rootSessionId:'other-root'};
  const merged=mergeHistoryPage(previous,{...page([updated,other]),diagnostics:['日志缺失']},identity,true);
  expect(merged.items).toEqual([updated,other]);expect(previous.items).toEqual([session]);expect(merged.diagnostics).toEqual(['日志缺失']);
  expect(mergeHistoryPage(merged,page([other]),identity).items).toEqual([other]);
});

test('历史分页拒绝跨工作区/角色/Session，切换观察键包括角色和完整任务轮次身份',()=>{
  expect(()=>mergeHistoryPage(undefined,page([{...session,workspaceId:'foreign'}]),identity)).toThrow('归属');
  expect(()=>mergeHistoryPage(undefined,page([{...session,agentId:'other-agent'}]),identity)).toThrow('归属');
  expect(()=>mergeHistoryPage(undefined,page([{...record,sessionId:'other-session'}]),{...identity,sessionId:record.sessionId})).toThrow('归属');
  expect(historyScopeKey(identity)).not.toBe(historyScopeKey({...identity,agentId:'cbim:executor'}));
  for(const change of [{workspaceId:'other'},{agentId:'other'},{sessionId:'other'},{taskId:'other'},{runId:'other'}])expect(historyRunKey(record)).not.toBe(historyRunKey({...record,...change}));
  const second={...record,taskId:'second-task'};
  expect(mergeHistoryPage(page([record]),page([record,second]),{...identity,sessionId:record.sessionId},true).items).toHaveLength(2);
});

test('旧履历保留未绑定标识，不把 legacy 分组键伪造成实例或主会话',()=>{
  const legacy:AgentHistoryRun={...record,source:'legacy',binding:'legacy',sessionId:'legacy:task',agentInstanceId:undefined,agentSessionId:undefined,rootSessionId:undefined,configurationRevision:undefined};
  expect(historyEventScope(legacy).rootSessionId).toBe('');
  const html=renderToStaticMarkup(createElement(HistoryRunContent,{record:legacy}));
  expect(html).toContain('未绑定实例或通道的旧记录');expect(html).toContain('未记录；不以当前配置代替');expect(html).not.toContain('执行实例</dt><dd>legacy:task');
});

test('主历史展示输入、公开回复、工具与计划证据，并区分历史配置而不提供执行操作',()=>{
  const event=(seq:number,type:string,data:Record<string,unknown>)=>({seq,time:record.startedAt,workspaceId:record.workspaceId,taskId:record.taskId,runId:record.runId,type,data});
  const run:RunSummary={task:{taskId:record.taskId,workspaceId:record.workspaceId,root:'C:/project',mode:'chat',agentId:record.agentId,goal:record.goal,moduleIds:[],acceptance:[]},runId:record.runId,status:'completed',acceptance:'not_evaluated',unresolvedTools:[],events:[event(1,'run.started',{message:'请审阅任务输出'}),event(2,'tool.proposed',{id:'read-proof',name:'read',input:{path:'result.txt'}}),event(3,'tool.finished',{id:'read-proof',name:'read',isError:false}),event(4,'message',{text:'公开回复：需要人工核验。'})] as RunSummary['events'],taskProgress:{version:1,goal:'核实结果',acceptance:['真实产物证据'],reason:'根据结果审阅',state:'awaiting_review',steps:[{id:'review',title:'审阅证据',owner:'主 Agent',state:'reported_done',evidence:['read-proof']}],delivery:{summary:'供人工审阅的候选',limitations:['尚未实际业务验收']}}};
  const html=renderToStaticMarkup(createElement(HistoryRunContent,{record,run}));
  for(const value of ['主会话输入','请审阅任务输出','公开回复：需要人工核验','read','read-proof','计划与验收证据','old-configuration','历史主角色','供人工审阅的候选','尚未验收'])expect(html).toContain(value);
  for(const action of ['停止成员执行','允许一次','本次任务全部通过','恢复执行'])expect(html).not.toContain(action);
  const injected=renderToStaticMarkup(createElement(HistoryRunContent,{record,run:{...run,source:{kind:'member-results',continuationId:'return-1',messageIds:['message'],taskIds:['member-task']}}}));
  expect(injected).toContain('回注来源');expect(injected).not.toContain('主会话输入');
});

test('已删除静态角色仍能从历史面板发起独立查询，不创建静态角色或执行实例',()=>{
  const html=renderToStaticMarkup(createElement(AgentSessionHistory,{workspaceId:'workspace',initialAgentId:'.cbim/team/removed',currentDefinitions:{'cbim:main':'CBIM 主 Agent','cbim:executor':'CBIM 默认执行 Agent'},knowledgeReady:true,onClose:()=>{}}));
  expect(html).toContain('当前定义已删除或不再登记');expect(html).toContain('不合并模型上下文');expect(html).toContain('返回团队定义');expect(html).not.toContain('新建 Agent');expect(html).not.toContain('停止成员执行');
});
