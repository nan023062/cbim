import {expect,it} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import type {DependencyReplacement,GraphSnapshot,TaskNode} from '../src/bridge/contracts/dispatch';
import {memberDependencyHistory} from '../src/view/tasks/member-dependency-state';
import {MemberDependencyNotice} from '../src/view/tasks/MemberDependencyNotice';
import {MemberTaskDetail} from '../src/view/tasks/MemberTaskDetail';
import {MemberActivity} from '../src/view/tasks/MemberActivity';
import {layoutDispatchGraph} from '../src/view/tasks/graph-layout';
import {DispatchGraph} from '../src/view/tasks/DispatchGraph';
import {sessionRoot} from '../src/view/tasks/SessionTaskView';

const identity={workspaceId:'workspace',rootSessionId:'root'},time='2026-11-07T00:00:00.000Z';
const main={agentId:'cbim:main',agentInstanceId:'main-instance',agentSessionId:'main-session',name:'主 Agent'},member={agentId:'cbim:executor',agentInstanceId:'member-instance',agentSessionId:'member-session',name:'执行者'};
function record():DependencyReplacement{return {commandId:'replace-command',scopeId:'scope',mainRunId:'main-run',replacedAt:time,reason:'原成员缺少数据，采用补做结果继续后续任务',graphCursor:{streamId:'graph',seq:5},goalRevision:4,goalPlanRevision:4,knowledgeRevision:'knowledge',previousTaskRevision:2,targetPlanRevision:1,retired:{edgeId:'old-edge',revision:1,sourceTaskId:'A',sourcePlanRevision:1},replacement:{edgeId:'new-edge',sourceTaskId:'A2',sourceTaskRevision:4,sourcePlanRevision:1,runId:'A2-run',resultId:'A2-result'},trackedTaskIds:['B','C']}}
function task():TaskNode{return {kind:'task',nodeId:'task:B',taskId:'B',identity,scopeId:'scope',requester:main,assignee:member,modules:[{moduleId:'module',name:'页面模块',knowledgeRevision:'knowledge',maintenanceBindingId:'binding',maintainerPersonIds:['person'],workflow:{kind:'general',id:'general',version:'1',reason:'默认流程'}}],goal:'基于前置结果核实页面',acceptance:[{id:'a',text:'验证页面'}],revision:3,planRevision:1,status:'queued',awaitedChildren:[],runIds:[],createdAt:time,updatedAt:time,dependencyReplacements:[record()]}}

it('明确审计独立于运行正文展示前后来源，不提供执行或验收按钮',()=>{
  const value=task(),html=renderToStaticMarkup(createElement(MemberDependencyNotice,{task:value}));
  expect(memberDependencyHistory(value)).toMatchObject({invalid:false,records:[record()]});
  for(const text of ['前置任务已替换','原成员缺少数据','A2-result','A2-run','原任务及其失败、求助或检查点放弃记录保留','不代表业务验收'])expect(html).toContain(text);
  expect(html).toContain('data-replacement-id="replace-command"');expect(html).toContain('dateTime="'+time+'"');expect(html).not.toMatch(/<(button|input|select|form)\b/);
  const detail=renderToStaticMarkup(createElement(MemberTaskDetail,{...identity,task:value}));expect(detail).toContain('member-dependency-replacement');expect(detail).toContain('该任务没有登记的执行轮次');expect(detail).not.toContain('停止成员执行');
});

it('后续正常执行仍能回看原替换，compact只显示最近条而详情保留全部',()=>{
  const second={...record(),commandId:'replace-second',previousTaskRevision:4,reason:'替换另一个未完成前置'},value={...task(),status:'running' as const,revision:7,runIds:['B-run'],activeRunId:'B-run',dependencyReplacements:[record(),second]};
  expect(memberDependencyHistory(value).records).toHaveLength(2);
  const compact=renderToStaticMarkup(createElement(MemberDependencyNotice,{task:value,compact:true})),full=renderToStaticMarkup(createElement(MemberDependencyNotice,{task:value}));
  expect(compact).toContain('2 次');expect(compact).not.toContain(record().reason);expect(full).toContain(record().reason);expect(full).toContain(second.reason);
});

it('无审计不从等待文案或空运行猜测替换，坏身份或改写顺序明确提示',()=>{
  const value=task();expect(renderToStaticMarkup(createElement(MemberDependencyNotice,{task:{...value,dependencyReplacements:undefined,waitReason:'已经替换'}}))).toBe('');
  const variants:TaskNode[]=[{...value,scopeId:'other'},{...value,scopeId:undefined},{...value,revision:2},{...value,dependencyReplacements:[]},{...value,dependencyReplacements:[{...record(),targetPlanRevision:2}]},{...value,dependencyReplacements:[{...record(),trackedTaskIds:['C']}]},{...value,revision:9,dependencyReplacements:[record(),record()]},{...value,revision:9,dependencyReplacements:[record(),{...record(),commandId:'second',previousTaskRevision:1}]}];
  for(const changed of variants){const projected=memberDependencyHistory(changed);expect(projected).toEqual({records:[],invalid:true});const html=renderToStaticMarkup(createElement(MemberDependencyNotice,{task:changed}));expect(html).toContain('member-dependency-invalid');expect(html).not.toContain('前置任务已替换');}
});

it('主对话和详情隔离其他会话，原因按文本输出而不执行HTML',()=>{
  const value=task();value.dependencyReplacements![0].reason='<script>替换原因</script>';
  const card=renderToStaticMarkup(createElement(MemberActivity,{...identity,tasks:[value],onSelectTask:()=>{}}));expect(card).toContain('member-dependency-replacement');expect(card).toContain('&lt;script&gt;');expect(card).not.toContain('<script>');
  expect(renderToStaticMarkup(createElement(MemberActivity,{workspaceId:'other',rootSessionId:'root',tasks:[value],onSelectTask:()=>{}}))).toBe('');
  const detail=renderToStaticMarkup(createElement(MemberTaskDetail,{workspaceId:'other',rootSessionId:'root',task:value}));expect(detail).toContain('不属于当前会话');expect(detail).not.toContain('member-dependency-replacement');
});

it('图保留原失败节点，只绘制当前启用前置并保持待办实例身份',()=>{
  const B=task(),A={...task(),taskId:'A',nodeId:'task:A',status:'blocked' as const,dependencyReplacements:undefined},A2={...task(),taskId:'A2',nodeId:'task:A2',status:'result_ready' as const,dependencyReplacements:undefined};
  const graph:GraphSnapshot={version:1,identity,cursor:{...identity,streamId:'graph',seq:6},root:{kind:'session-root',nodeId:'session:root',identity,agent:main,revision:1,createdAt:time},tasks:[A,B,A2],agents:[],edges:[...[A,B,A2].map(t=>({edgeId:'dispatch-'+t.taskId,identity,kind:'dispatch' as const,fromNodeId:'session:root',toNodeId:t.nodeId,revision:1,enabled:true})),{edgeId:'old-edge',identity,kind:'dependency',fromNodeId:A.nodeId,toNodeId:B.nodeId,revision:2,enabled:false,condition:{kind:'result_ready',planRevision:1}},{edgeId:'new-edge',identity,kind:'dependency',fromNodeId:A2.nodeId,toNodeId:B.nodeId,revision:1,enabled:true,condition:{kind:'result_ready',planRevision:1,resultId:'A2-result'}}]};
  const before=structuredClone(graph),layout=layoutDispatchGraph(graph,graph.root.nodeId),root=sessionRoot([],'root',0,graph),html=renderToStaticMarkup(createElement(DispatchGraph,{graph,root,onSelectTask:()=>{}}));
  expect(layout.nodes).toHaveLength(4);expect(layout.edges.some(x=>x.edge.edgeId==='old-edge')).toBe(false);expect(html).toContain('data-from="task:A2" data-to="task:B"');expect(html).not.toContain('data-from="task:A" data-to="task:B"');expect(html).toContain('data-status="blocked"');expect(graph).toEqual(before);expect(B.assignee.agentInstanceId).toBe('member-instance');
});
