import {expect,it} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import type {GraphSnapshot,TaskNode} from '../src/bridge/contracts/dispatch';
import {committedMemberCancellation,memberCancellationLabel} from '../src/view/tasks/member-cancellation-state';
import {MemberCancellationNotice} from '../src/view/tasks/MemberCancellationNotice';
import {MemberActivity,memberTaskLabel} from '../src/view/tasks/MemberActivity';
import {MemberTaskDetail} from '../src/view/tasks/MemberTaskDetail';
import {sessionRoot} from '../src/view/tasks/SessionTaskView';

const identity={workspaceId:'workspace',rootSessionId:'root'},time='2026-11-07T00:00:00.000Z';
const main={agentId:'cbim:main',agentInstanceId:'main-instance',agentSessionId:'main-session',name:'主 Agent'},member={agentId:'cbim:executor',agentInstanceId:'executor-instance',agentSessionId:'executor-session',name:'默认执行 Agent'};
function task():TaskNode{return {kind:'task',nodeId:'task:queued',taskId:'queued',identity,scopeId:'scope',requester:main,assignee:member,modules:[{moduleId:'module',name:'网页模块',knowledgeRevision:'knowledge',maintenanceBindingId:'binding',maintainerPersonIds:['person'],workflow:{kind:'general',id:'general',version:'1',reason:'默认流程'}}],goal:'验收页面功能',acceptance:[{id:'a',text:'核实页面可运行'}],revision:3,planRevision:1,status:'cancelled',awaitedChildren:[],runIds:[],createdAt:time,updatedAt:time,cancelledBeforeStart:{commandId:'cancel-command',scopeId:'scope',mainRunId:'main-run',reason:'前置任务缺少验收数据\n等待用户补充后重新安排',cancelledAt:time,previousRevision:2,graphCursor:{streamId:'graph',seq:5}}}}
function graph(value=task()):GraphSnapshot{return {version:1,identity,cursor:{...identity,streamId:'graph',seq:6},root:{kind:'session-root',nodeId:'session:root',identity,agent:main,revision:1,createdAt:time},tasks:[value],edges:[{edgeId:'edge',identity,kind:'dispatch',fromNodeId:'session:root',toNodeId:value.nodeId,revision:1,enabled:true}],agents:[]}}

it('明确的未启动撤销独立于执行日志展示原因与后端记录时间，不产生操作按钮',()=>{
  const value=task();expect(committedMemberCancellation(value)).toBe(value.cancelledBeforeStart);expect(memberTaskLabel(value)).toBe(memberCancellationLabel);
  const html=renderToStaticMarkup(createElement(MemberCancellationNotice,{task:value}));
  expect(html).toContain('已撤销（未启动）');expect(html).toContain('data-task-id="queued"');expect(html).toContain('data-cancel-id="cancel-command"');expect(html).toContain('data-testid="member-cancellation-reason"');expect(html).toContain('前置任务缺少验收数据\n等待用户补充后重新安排');expect(html).toContain('dateTime="'+time+'"');expect(html).toContain('撤销不代表任务完成');expect(html).not.toMatch(/<(button|input|select|form)\b/);
  const detail=renderToStaticMarkup(createElement(MemberTaskDetail,{...identity,task:value}));
  expect(detail).toContain('data-testid="member-cancellation"');expect(detail).toContain('该任务没有登记的执行轮次');expect(detail).not.toContain('成员执行轮次');expect(detail).not.toContain('停止成员执行');expect(detail).not.toContain('交付候选 · 尚未验收');expect(detail).not.toContain('data-testid="member-help"');
});

it.each(['planned','queued','running','waiting','result_ready','blocked','failed','interrupted'] as const)('%s 残留撤销字段不能变成未启动撤销事实',status=>{
  const value={...task(),status};expect(committedMemberCancellation(value)).toBeUndefined();expect(memberTaskLabel(value)).not.toBe(memberCancellationLabel);expect(renderToStaticMarkup(createElement(MemberCancellationNotice,{task:value}))).toBe('');
});

it('无记录的旧取消与运行后停止只显示已停止，不能通过空run或waitReason猜测未执行',()=>{
  const value={...task(),cancelledBeforeStart:undefined,waitReason:'已撤销（未启动）'};
  expect(committedMemberCancellation(value)).toBeUndefined();expect(memberTaskLabel(value)).toBe('已停止');
  const card=renderToStaticMarkup(createElement(MemberActivity,{...identity,tasks:[value],onSelectTask:()=>{}}));
  expect(card).not.toContain('data-testid="member-cancellation"');expect(card).not.toContain(memberCancellationLabel);expect(card).toContain('取消状态本身不能证明未执行');
  const started={...value,runIds:['old-run']};expect(committedMemberCancellation(started)).toBeUndefined();expect(memberTaskLabel(started)).toBe('已停止');
});

it('撤销记录必须匹配冻结的scope、节点版本与时间，运行、候选、求助或未清依赖均拒绝投影',()=>{
  const value=task();
  const variants:TaskNode[]=[
    {...value,scopeId:undefined},{...value,scopeId:'other-scope'},
    {...value,revision:4},{...value,updatedAt:'2026-11-07T01:00:00.000Z'},
    {...value,runIds:['old-run']},{...value,activeRunId:'starting-run'},
    {...value,awaitedChildren:[{taskId:'dependency',planRevision:1}]},
    {...value,result:{resultId:'result',runId:'old-run',planRevision:1,summary:'结果不能同时撤销',evidenceRefs:[],limitations:[],acceptance:'not_evaluated'}},
    {...value,help:{helpId:'help',toolCallId:'help-call',binding:{...identity,taskId:value.taskId,teamId:'team',agentId:member.agentId,agentInstanceId:member.agentInstanceId,agentSessionId:member.agentSessionId,runId:'old-run',leaseEpoch:1,planRevision:1},input:{kind:'dependency',reason:'不能同时交接求助',question:'需要协助',attemptedToolCallIds:[]},requestedAt:time,requestedSeq:1,finishedSeq:2,lastEffectSeq:0}},
  ];
  for(const changed of variants){expect(committedMemberCancellation(changed)).toBeUndefined();expect(renderToStaticMarkup(createElement(MemberCancellationNotice,{task:changed}))).toBe('')}
});


it('其他会话的撤销记录不进入当前成员卡或详情，原始原因按文本输出',()=>{
  const value=task();value.cancelledBeforeStart!.reason='<script>不能执行</script>';
  expect(renderToStaticMarkup(createElement(MemberActivity,{workspaceId:'foreign',rootSessionId:'root',tasks:[value],onSelectTask:()=>{}}))).toBe('');
  const foreign=renderToStaticMarkup(createElement(MemberTaskDetail,{workspaceId:'foreign',rootSessionId:'root',task:value}));expect(foreign).toContain('不属于当前会话');expect(foreign).not.toContain('data-testid="member-cancellation"');
  const notice=renderToStaticMarkup(createElement(MemberCancellationNotice,{task:value}));expect(notice).toContain('&lt;script&gt;不能执行&lt;/script&gt;');expect(notice).not.toContain('<script>');
});
