import {expect,it} from 'vitest';
import {teamConversations,memberConversationTasks,teamConversationKey} from '../src/view/execution-view/team-conversations';
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
