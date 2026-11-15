import {expect,it} from 'vitest';
import {teamConversations,memberConversationTasks,teamConversationKey,taskConversationTarget} from '../src/view/execution-view/team-conversations';
import {officeSession,officeGraph,officeTask} from './team-conversation-fixture';

it('一个逻辑子 Session 合并多个任务执行实例，并跨话题保留唯一导航',()=>{
  const first=officeTask('first'),second={...officeTask('second','next'),status:'running' as const,activeRunId:'run'};
  const items=teamConversations([officeSession('main','main-session'),officeSession()],officeGraph([first,second]));
  expect(items).toHaveLength(1);expect(items[0]).toMatchObject({name:'建模员',running:true,taskIds:['first','second'],session:{sessionId:'worker-session'}});
  expect(teamConversations([officeSession()],officeGraph())[0]).toMatchObject({name:'建模员',running:false,taskIds:[]});
});
it('跨办公室登记和任务不混入本子对话，缺登记不伪造旧 Session',()=>{
  const foreign={...officeSession(),rootSessionId:'other'},task=officeTask('one');
  expect(teamConversations([foreign],officeGraph([task]))).toEqual([]);
  expect(memberConversationTasks(foreign,officeGraph([task]))).toEqual([]);
  expect(memberConversationTasks(officeSession(),officeGraph([{...task,identity:{...task.identity,rootSessionId:'other'}}]))).toEqual([]);
  expect(teamConversations(undefined,officeGraph([task]))).toEqual([]);
  expect(teamConversationKey('workspace','instance-1','root')).not.toBe(teamConversationKey('workspace','instance-2','root'));
});

it('任务定位使用原逻辑成员和话题；主根及主 Agent 自执行回到主对话',()=>{
  const graph=officeGraph([officeTask('old','old-topic'),officeTask('next','next-topic')]),sessions=[officeSession()];
  expect(taskConversationTarget(graph.identity,graph,sessions,'old')).toEqual({sessionId:'worker-session',scopeId:'old-topic',taskId:'old'});
  expect(taskConversationTarget(graph.identity,graph,sessions,graph.root.nodeId)).toEqual({});
  graph.tasks[0].assignee=graph.root.agent;
  expect(taskConversationTarget(graph.identity,graph,sessions,'old')).toEqual({scopeId:'old-topic'});
});
it('定位拒绝缺失或重复的成员登记、跨办公室任务及不存在的任务',()=>{
  const graph=officeGraph([officeTask('old')]),session=officeSession();
  expect(()=>taskConversationTarget(graph.identity,graph,undefined,'old')).toThrow('缺少唯一');
  expect(()=>taskConversationTarget(graph.identity,graph,[session,{...session,sessionId:'duplicate'}],'old')).toThrow('缺少唯一');
  expect(()=>taskConversationTarget(graph.identity,graph,[session],'missing')).toThrow('原任务暂不可读取');
  expect(()=>taskConversationTarget({...graph.identity,rootSessionId:'foreign'},graph,[session],'old')).toThrow('不属于当前办公室');
  graph.tasks[0].identity={...graph.identity,rootSessionId:'foreign'};
  expect(()=>taskConversationTarget(graph.identity,graph,[session],'old')).toThrow('不属于当前办公室');
});
