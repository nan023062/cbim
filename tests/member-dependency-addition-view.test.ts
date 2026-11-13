import {expect,it} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import type {DependencyAddition,DependencyReplacement,GraphSnapshot,TaskNode} from '../src/bridge/contracts/dispatch';
import {memberDependencyAdditionHistory} from '../src/view/tasks/member-dependency-state';
import {MemberDependencyNotice} from '../src/view/tasks/MemberDependencyNotice';
import {MemberTaskDetail} from '../src/view/tasks/MemberTaskDetail';
import {MemberActivity} from '../src/view/tasks/MemberActivity';
import {layoutDispatchGraph} from '../src/view/tasks/graph-layout';

const identity={workspaceId:'workspace',rootSessionId:'root'},time='2026-11-07T00:00:00.000Z';
const main={agentId:'cbim:main',agentInstanceId:'main-instance',agentSessionId:'main-session',name:'主 Agent'},member={agentId:'cbim:executor',agentInstanceId:'member-instance',agentSessionId:'member-session',name:'执行者'};
function record():DependencyAddition{return {commandId:'add-command',scopeId:'scope',mainRunId:'main-run',addedAt:time,reason:'读取接口前先等待后建任务的结构说明',graphCursor:{streamId:'graph',seq:5},goalRevision:2,goalPlanRevision:2,knowledgeRevision:'knowledge',previousTaskRevision:1,targetPlanRevision:1,dependency:{edgeId:'added-edge',sourceTaskId:'A',sourceTaskRevision:1,sourcePlanRevision:1},trackedTaskIds:['B','C','A']}}
function task():TaskNode{return {kind:'task',nodeId:'task:B',taskId:'B',identity,scopeId:'scope',requester:main,assignee:member,modules:[{moduleId:'module',name:'页面模块',knowledgeRevision:'knowledge',maintenanceBindingId:'binding',maintainerPersonIds:['person'],workflow:{kind:'general',id:'general',version:'1',reason:'默认流程'}}],goal:'根据前置核实页面',acceptance:[{id:'a',text:'验证页面'}],revision:2,planRevision:1,status:'waiting',awaitedChildren:[],runIds:[],createdAt:time,updatedAt:time,dependencyAdditions:[record()]}}
function replaced():DependencyReplacement{return {commandId:'replace-command',scopeId:'scope',mainRunId:'main-run-2',replacedAt:'2026-11-07T00:00:01.000Z',reason:'后续替换已失败来源',graphCursor:{streamId:'graph',seq:8},goalRevision:2,goalPlanRevision:2,knowledgeRevision:'knowledge',previousTaskRevision:3,targetPlanRevision:1,retired:{edgeId:'added-edge',revision:1,sourceTaskId:'A',sourcePlanRevision:1},replacement:{edgeId:'new-edge',sourceTaskId:'A2',sourceTaskRevision:4,sourcePlanRevision:1,runId:'A2-run',resultId:'A2-result'},trackedTaskIds:['B','C']}}
const render=(value:TaskNode,compact=false)=>renderToStaticMarkup(createElement(MemberDependencyNotice,{task:value,compact}));

it('新增前置保留原实例并展示当时的任务和计划，不编造未发生的结果或执行入口',()=>{
  const value=task(),before=structuredClone(value),html=render(value);
  expect(memberDependencyAdditionHistory(value)).toEqual({records:[record()],invalid:false});
  for(const text of ['已追加前置任务','读取接口前','前置计划版本','main-run','不能证明执行完成或业务验收','data-addition-id="add-command"'])expect(html).toContain(text);
  expect(html).not.toMatch(/<(button|input|select|form)\b/);expect(html).not.toContain('采用的候选');expect(html).not.toContain('候选执行轮次');expect(value).toEqual(before);
  const detail=renderToStaticMarkup(createElement(MemberTaskDetail,{...identity,task:value}));expect(detail).toContain('member-dependency-addition');expect(detail).toContain('该任务没有登记的执行轮次');
});

it('后续已运行节点仍能看追加历史，compact按节点版本选择混合历史最新项而非时间',()=>{
  const value={...task(),revision:7,status:'result_ready' as const,runIds:['B-run'],dependencyReplacements:[replaced()]};
  const full=render(value),compact=render(value,true);
  expect(full).toContain(record().reason);expect(full).toContain(replaced().reason);expect(compact).not.toContain(record().reason);expect(compact).toContain(replaced().reason);
  // 两次调整的记录时间相同，仍按实际节点修订确定最新摘要，不依赖数组拼接或格式化时间排序。
  const second={...record(),commandId:'second-add',previousTaskRevision:5,addedAt:replaced().replacedAt,reason:'再增加另一个真实前置',dependency:{...record().dependency,edgeId:'edge-third',sourceTaskId:'D'},trackedTaskIds:['B','D']};
  const changed={...value,dependencyAdditions:[record(),second]},latest=render(changed,true);
  expect(latest).toContain(second.reason);expect(latest).not.toContain(replaced().reason);expect(latest).toContain('2 次');expect(render(changed)).toContain(replaced().reason);
});

it('旧缺省保持原样，不从等待文案或图连线推测追加；坏审计阻止展示成功事实',()=>{
  const value=task();expect(render({...value,dependencyAdditions:undefined,waitReason:'已追加前置'})).toBe('');
  const variants:TaskNode[]=[{...value,scopeId:undefined},{...value,scopeId:'other'},{...value,revision:1},{...value,dependencyAdditions:[]},{...value,dependencyAdditions:null as unknown as DependencyAddition[]},{...value,dependencyAdditions:[{...record(),targetPlanRevision:2}]},{...value,dependencyAdditions:[{...record(),trackedTaskIds:['B','C']}]},{...value,dependencyAdditions:[{...record(),trackedTaskIds:['A','C']}]},{...value,dependencyAdditions:[{...record(),dependency:{...record().dependency,sourceTaskId:'B'}}]},{...value,revision:9,dependencyAdditions:[record(),record()]},{...value,dependencyAdditions:[{...record(),extraResult:'fabricated'} as DependencyAddition]}];
  for(const changed of variants){expect(memberDependencyAdditionHistory(changed)).toEqual({records:[],invalid:true});const html=render(changed);expect(html).toContain('member-dependency-invalid');expect(html).not.toContain('已追加前置任务');}
});

it('追加和替换不得借同一命令或节点版本占用两次历史，任一坏记录不显示另一条为可信',()=>{
  const value={...task(),revision:5};
  for(const replacement of [{...replaced(),commandId:record().commandId},{...replaced(),previousTaskRevision:record().previousTaskRevision}]){const html=render({...value,dependencyReplacements:[replacement]});expect(html).toContain('member-dependency-invalid');expect(html).not.toContain('已追加前置任务');expect(html).not.toContain('前置任务已替换');}
});

it('真实任务详情和成员卡仅消费本会话审计，原因作为文本输出',()=>{
  const value=task();value.dependencyAdditions![0].reason='<script>不执行来源文字</script>';
  const html=renderToStaticMarkup(createElement(MemberActivity,{...identity,tasks:[value],onSelectTask:()=>{}}));expect(html).toContain('member-dependency-addition');expect(html).toContain('&lt;script&gt;');expect(html).not.toContain('<script>');
  expect(renderToStaticMarkup(createElement(MemberActivity,{workspaceId:'other',rootSessionId:'root',tasks:[value],onSelectTask:()=>{}}))).toBe('');
  const wrong=renderToStaticMarkup(createElement(MemberTaskDetail,{workspaceId:'workspace',rootSessionId:'other',task:value}));expect(wrong).toContain('不属于当前会话');expect(wrong).not.toContain('member-dependency-addition');
});

it('后来创建的A按真实追加边排在原B和C之前，不复制原任务或成员身份',()=>{
  const B=task(),C={...task(),taskId:'C',nodeId:'task:C',dependencyAdditions:undefined},A={...task(),taskId:'A',nodeId:'task:A',status:'queued' as const,dependencyAdditions:undefined,createdAt:'2026-11-07T00:01:00.000Z'};
  const graph:GraphSnapshot={version:1,identity,cursor:{...identity,streamId:'graph',seq:6},root:{kind:'session-root',nodeId:'session:root',identity,agent:main,revision:1,createdAt:time},tasks:[B,C,A],agents:[],edges:[...[B,C,A].map(t=>({edgeId:'dispatch-'+t.taskId,identity,kind:'dispatch' as const,fromNodeId:'session:root',toNodeId:t.nodeId,revision:1,enabled:true})),{edgeId:'edge-bc',identity,kind:'dependency',fromNodeId:B.nodeId,toNodeId:C.nodeId,revision:1,enabled:true,condition:{kind:'result_ready',planRevision:1}}]};
  const before=layoutDispatchGraph(graph,graph.root.nodeId),next={...graph,edges:[...graph.edges,{edgeId:'added-edge',identity,kind:'dependency' as const,fromNodeId:A.nodeId,toNodeId:B.nodeId,revision:1,enabled:true,condition:{kind:'result_ready' as const,planRevision:1}}]},frozen=structuredClone(next),layout=layoutDispatchGraph(next,next.root.nodeId,before);
  expect(layout.nodes).toHaveLength(4);expect(layout.nodes.find(n=>n.taskId==='A')!.rank).toBeLessThan(layout.nodes.find(n=>n.taskId==='B')!.rank);expect(layout.nodes.find(n=>n.taskId==='B')!.rank).toBeLessThan(layout.nodes.find(n=>n.taskId==='C')!.rank);expect(layout.edges.find(e=>e.edge.edgeId==='added-edge')!.edge).not.toHaveProperty('condition.resultId');expect(next).toEqual(frozen);expect(next.tasks[0]).toBe(B);expect(B.assignee.agentInstanceId).toBe('member-instance');
});
