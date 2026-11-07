import {expect,it} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import type {GraphSnapshot,ScopeSummary,TaskNode} from '../src/bridge/contracts/dispatch';
import {memberCheckpointView} from '../src/frontend/tasks/member-checkpoint-state';
import {MemberCheckpointNotice} from '../src/frontend/tasks/MemberCheckpointNotice';
import {MemberActivity,memberTaskLabel} from '../src/frontend/tasks/MemberActivity';
import {MemberTaskDetail} from '../src/frontend/tasks/MemberTaskDetail';
import {DispatchGraph} from '../src/frontend/tasks/DispatchGraph';
import {sessionRoot} from '../src/frontend/tasks/SessionTaskView';
import {scopeGoalView} from '../src/frontend/tasks/scope-state';

const identity={workspaceId:'workspace',rootSessionId:'root'},time='2026-11-07T01:00:00.000Z';
const main={agentId:'cbim:main',agentInstanceId:'main-instance',agentSessionId:'main-session',name:'主 Agent'},member={agentId:'cbim:executor',agentInstanceId:'executor-instance',agentSessionId:'executor-session',name:'默认执行 Agent'};
function task():TaskNode{return {kind:'task',nodeId:'task:member',taskId:'member',identity,scopeId:'scope',requester:main,assignee:member,modules:[{moduleId:'module',name:'网页模块',knowledgeRevision:'knowledge',maintenanceBindingId:'binding',maintainerPersonIds:['person'],workflow:{kind:'general',id:'general',version:'1',reason:'通用流程'}}],goal:'完成有界文件任务',acceptance:[{id:'criterion',text:'读取结果核实'}],revision:4,planRevision:1,status:'checkpointed',awaitedChildren:[],runIds:['source-run'],createdAt:time,updatedAt:time,checkpoints:[{version:1,checkpointId:'checkpoint',toolCallId:'checkpoint-call',binding:{...identity,teamId:'team',agentId:member.agentId,agentInstanceId:member.agentInstanceId,agentSessionId:member.agentSessionId,taskId:'member',runId:'source-run',leaseEpoch:1,planRevision:1},input:{expectedTaskProgressVersion:3,baselineId:'baseline',reason:'已保存第一段文件\n后续需要重新验证'},knowledgeRevision:'knowledge',requestedAt:time,lastEffectSeq:14,requestedSeq:20,finishedSeq:21,terminalSeq:24}]}}
function queued():TaskNode{const value=task();return {...value,status:'queued',revision:5,resumeRequest:{requestId:'resume-message',commandId:'resume-command',scopeId:'scope',mainRunId:'main-run',checkpointId:'checkpoint',runId:'source-run',requestedAt:time,reason:'核实原目标后继续',graphCursor:{streamId:'stream',seq:4},goalRevision:2,previousTaskRevision:4,trackedTaskIds:['member','successor']}}}
function resumed():TaskNode{return {...queued(),revision:6,status:'running',runIds:['source-run','resumed-run'],activeRunId:'resumed-run'}}
function graph(value=task()):GraphSnapshot{return {version:1,identity,cursor:{...identity,streamId:'stream',seq:value.revision},root:{kind:'session-root',nodeId:'session:root',identity,agent:main,revision:1,createdAt:time},tasks:[value],edges:[{edgeId:'dispatch',identity,kind:'dispatch',fromNodeId:'session:root',toNodeId:value.nodeId,revision:1,enabled:true}],agents:[]}}
const notice=(value:TaskNode,runId?:string)=>renderToStaticMarkup(createElement(MemberCheckpointNotice,{task:value,runId}));

it('停泊来自正常交接记录而非工具文字；界面不生成恢复或验收操作',()=>{
  const value=task(),html=notice(value);expect(memberCheckpointView(value).phase).toBe('parked');expect(memberTaskLabel(value)).toBe('已保存检查点');
  expect(html).toContain('data-phase="parked"');expect(html).toContain('本轮已正常关闭');expect(html).toContain('后续需要重新验证');expect(html).toContain('baseline');expect(html).not.toMatch(/<(button|input|form)\b/);
  const staged={...value,status:'running' as const,checkpoints:undefined,waitReason:'cbim_task_checkpoint returned staged'};expect(notice(staged)).toBe('');
  expect(notice({...value,checkpoints:undefined})).toContain('member-checkpoint-invalid');
});

it('排入预约不冒充消费或执行；新run才显示续执行且保留同任务通道',()=>{
  const pending=queued();expect(memberCheckpointView(pending).phase).toBe('queued');expect(memberTaskLabel(pending)).toBe('等待续执行');expect(notice(pending)).toContain('尚未登记新轮次');expect(notice(pending)).not.toContain('data-resumed-run-id');
  const running=resumed();expect(memberCheckpointView(running).phase).toBe('resumed');expect(memberTaskLabel(running)).toBe('正在执行');expect(notice(running)).toContain('data-resumed-run-id="resumed-run"');
  expect(notice({...running,status:'queued'})).not.toContain('正在执行');expect(memberTaskLabel({...running,status:'queued'})).toBe('正在启动');
});

it('停止、失败和重启封存保留历史，不能显示仍可续执行',()=>{
  for(const status of ['cancelled','failed','interrupted'] as const)for(const source of [task(),queued(),resumed()]){
    const value={...source,status,activeRunId:undefined},html=notice(value);expect(memberCheckpointView(value).phase).toBe('sealed');expect(html).toContain('检查点仅作历史记录，不能沿此恢复');expect(html).not.toContain('等待后续安排');
  }
});

it('拒绝跨身份、假预约、没有预约的第二轮以及被改写的计划或序号',()=>{
  const original=task(),record=original.checkpoints![0];
  for(const key of ['workspaceId','rootSessionId','taskId','agentId','agentInstanceId','agentSessionId'] as const){const value={...original,checkpoints:[{...record,binding:{...record.binding,[key]:'foreign'}}]};expect(memberCheckpointView(value).invalid,key).toBe(true);expect(notice(value)).not.toContain('后续需要重新验证')}
  const malformed:TaskNode[]=[{...original,planRevision:2},{...original,checkpoints:[{...record,terminalSeq:21}]},{...original,checkpoints:[record,record]},{...original,runIds:['foreign']},{...original,runIds:['source-run','resumed-run'],status:'running'}, {...resumed(),runIds:['source-run','resumed-run','third-run']},{...queued(),resumeRequest:{...queued().resumeRequest!,scopeId:'foreign'}},{...queued(),resumeRequest:{...queued().resumeRequest!,trackedTaskIds:['foreign']}},{...queued(),resumeRequest:{...queued().resumeRequest!,previousTaskRevision:5}}];
  for(const value of malformed)expect(memberCheckpointView(value).invalid).toBe(true);
});

it('选择源轮次与新轮次共享交接但不会借用其他轮次候选；错误身份不泄露详情',()=>{
  const value={...resumed(),status:'result_ready' as const,activeRunId:undefined,result:{resultId:'candidate',runId:'resumed-run',planRevision:1,summary:'重新验证后的候选',evidenceRefs:['fresh-read'],limitations:[],acceptance:'not_evaluated' as const}};
  for(const runId of value.runIds)expect(notice(value,runId)).toContain('data-run-id="source-run"');expect(notice(value,'foreign')).toBe('');
  expect(renderToStaticMarkup(createElement(MemberTaskDetail,{workspaceId:'foreign',rootSessionId:'root',task:value}))).not.toContain('后续需要重新验证');
  const detail=renderToStaticMarkup(createElement(MemberTaskDetail,{...identity,task:value}));expect(detail).toContain('第 1 次');expect(detail).toContain('第 2 次');expect(detail).toContain('重新验证后的候选');expect(detail).not.toContain('停止成员执行');
});

it('主对话及图使用相同检查点事实，不新增成员节点或改变连线',()=>{
  for(const value of [task(),queued(),resumed()]){
    const snapshot=graph(value),root=sessionRoot([],identity.rootSessionId,0,snapshot),nodes=renderToStaticMarkup(createElement(DispatchGraph,{graph:snapshot,root,onSelectTask:()=>{}})),cards=renderToStaticMarkup(createElement(MemberActivity,{...identity,tasks:[value],onSelectTask:()=>{}}));
    expect(nodes.match(/data-testid="dispatch-task-node"/g)).toHaveLength(1);expect(nodes).toContain('data-from="session:root" data-to="task:member"');expect(nodes).toContain('data-checkpoint-id="checkpoint"');expect(cards).toContain('data-checkpoint-id="checkpoint"');
    if(value.status==='checkpointed'){expect(nodes).not.toContain('task-state-dot animated');expect(cards).toContain('任务尚未完成')}
  }
});

it('续轮真实求助可与原检查点历史并存，不能把原轮次自身签成候选或求助',()=>{
  const value=resumed(),binding={...value.checkpoints![0].binding,runId:'resumed-run',leaseEpoch:2},help={helpId:'help',toolCallId:'help-call',binding,input:{kind:'missing_input' as const,reason:'需要新的业务数据',question:'请提供目标数据',attemptedToolCallIds:[]},requestedAt:time,requestedSeq:10,finishedSeq:11,lastEffectSeq:0};
  const helped={...value,status:'blocked' as const,activeRunId:undefined,help};expect(memberCheckpointView(helped).invalid).toBe(false);expect(memberCheckpointView(helped).phase).toBe('sealed');expect(notice(helped)).toContain('检查点已封存');expect(memberTaskLabel(helped)).toBe('需要主调度协助');
  expect(memberCheckpointView({...helped,help:{...help,binding:{...binding,runId:'source-run'}}}).invalid).toBe(true);
});

it('成员检查点只改变当前周期摘要，不把历史停泊或主周期等待当执行',()=>{
  const scope={scopeId:'scope',status:'active',hasGoal:true,hasPlan:true} as ScopeSummary;
  expect(scopeGoalView(scope,graph()).phase).toBe('member_checkpoint');expect(scopeGoalView({...scope,scopeId:'other'},graph()).phase).toBe('planning');expect(scopeGoalView({...scope,status:'waiting'},graph()).phase).toBe('waiting');
  expect(scopeGoalView({...scope,status:'closed',outcome:'interrupted'},graph()).phase).toBe('interrupted');
});
