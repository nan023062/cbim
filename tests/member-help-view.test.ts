import {expect,it} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import type {GraphSnapshot,TaskNode} from '../src/bridge/contracts/dispatch';
import {committedMemberHelp,memberHelpKindLabels} from '../src/view/tasks/member-help-state';
import {MemberHelpNotice} from '../src/view/tasks/MemberHelpNotice';
import {MemberActivity,memberTaskLabel} from '../src/view/tasks/MemberActivity';
import {MemberTaskDetail} from '../src/view/tasks/MemberTaskDetail';
import {sessionRoot} from '../src/view/tasks/session-task-state';

const identity={workspaceId:'workspace',rootSessionId:'root'},time='2026-11-07T00:00:00.000Z';
const main={agentId:'cbim:main',agentInstanceId:'main-instance',agentSessionId:'main-session',name:'主 Agent'},member={agentId:'cbim:executor',agentInstanceId:'executor-instance',agentSessionId:'executor-session',name:'默认执行 Agent'};
function task():TaskNode{return {kind:'task',nodeId:'task:member',taskId:'member',identity,scopeId:'scope',requester:main,assignee:member,modules:[{moduleId:'module',name:'网页模块',knowledgeRevision:'knowledge',maintenanceBindingId:'binding',maintainerPersonIds:['person'],workflow:{kind:'general',id:'general',version:'1',reason:'默认流程'}}],goal:'验证网页结果',acceptance:[{id:'a',text:'核实可运行'}],revision:4,planRevision:1,status:'blocked',awaitedChildren:[],runIds:['member-run'],createdAt:time,updatedAt:time,help:{helpId:'help',toolCallId:'help-tool',binding:{...identity,teamId:'team',agentId:member.agentId,agentInstanceId:member.agentInstanceId,agentSessionId:member.agentSessionId,taskId:'member',runId:'member-run',leaseEpoch:1,planRevision:1},input:{kind:'missing_input',reason:'缺少真实验收数据\n不能把示例当作最终数据',question:'请主调度确定有效数据来源',attemptedToolCallIds:['read-source','find-fixture']},requestedAt:time,requestedSeq:20,finishedSeq:21,lastEffectSeq:16}}}
function graph(memberTask=task()):GraphSnapshot{return {version:1,identity,cursor:{...identity,streamId:'graph',seq:4},root:{kind:'session-root',nodeId:'session:root',identity,agent:main,revision:1,createdAt:time},tasks:[memberTask],edges:[{edgeId:'edge',identity,kind:'dispatch',fromNodeId:'session:root',toNodeId:memberTask.nodeId,revision:1,enabled:true}],agents:[]}}

it('只有绑定匹配的已结算 blocked 求助可显示，同轮公开记录尚未读取也不影响交接事实',()=>{
  const value=task();expect(committedMemberHelp(value)).toBe(value.help);expect(committedMemberHelp(value,'member-run')).toBe(value.help);expect(memberTaskLabel(value)).toBe('需要主调度协助');
  const html=renderToStaticMarkup(createElement(MemberTaskDetail,{...identity,task:value}));
  expect(html).toContain('data-testid="member-help"');expect(html).toContain('data-help-id="help"');expect(html).toContain('本轮成员执行已结束，求助已交接主调度');expect(html).toContain('后续任务由主调度重新安排');expect(html).toContain('缺少真实验收数据');expect(html).toContain('请主调度确定有效数据来源');expect(html).toContain('read-source');expect(html).toContain('find-fixture');
  expect(html.indexOf('data-testid="member-help"')).toBeLessThan(html.indexOf('member-run-detail'));
  expect(html).not.toContain('交付候选 · 尚未验收');expect(html).not.toContain('停止成员执行');expect(html).not.toContain('允许一次');expect(html).not.toContain('恢复成员');
});

it.each(['planned','queued','running','waiting','result_ready','failed','cancelled','interrupted'] as const)('%s 或异常记录不能凭残留help显示成安全交接',status=>{
  const value={...task(),status};expect(committedMemberHelp(value)).toBeUndefined();expect(memberTaskLabel(value)).not.toBe('需要主调度协助');expect(renderToStaticMarkup(createElement(MemberHelpNotice,{task:value}))).toBe('');
});

it('普通blocked与staged工具文字不构造help；在途任务或候选不能同时冒充求助交接',()=>{
  const value=task(),blocked={...value,help:undefined,waitReason:'cbim_task_help returned staged: 需要帮助'};
  expect(committedMemberHelp(blocked)).toBeUndefined();expect(memberTaskLabel(blocked)).toBe('需要处理');expect(renderToStaticMarkup(createElement(MemberHelpNotice,{task:blocked}))).toBe('');
  expect(committedMemberHelp({...value,activeRunId:'member-run'})).toBeUndefined();
  expect(committedMemberHelp({...value,result:{resultId:'result',runId:'member-run',planRevision:1,summary:'不能同时交付',evidenceRefs:[],limitations:[],acceptance:'not_evaluated'}})).toBeUndefined();
});

it('工作区、主会话、任务、角色、实例、通道和计划身份任何变化都不能借用旧求助',()=>{
  const value=task();for(const key of ['workspaceId','rootSessionId','taskId','agentId','agentInstanceId','agentSessionId'] as const){const changed={...value,help:{...value.help!,binding:{...value.help!.binding,[key]:'foreign'}}};expect(committedMemberHelp(changed),key).toBeUndefined()}
  expect(committedMemberHelp({...value,planRevision:2})).toBeUndefined();expect(committedMemberHelp({...value,runIds:[]})).toBeUndefined();
  const foreign=renderToStaticMarkup(createElement(MemberTaskDetail,{workspaceId:'foreign',rootSessionId:'root',task:value}));expect(foreign).toContain('不属于当前会话');expect(foreign).not.toContain('缺少真实验收数据');
});

it('选择另一运行轮次不显示旧求助；没有尝试工具时如实呈现，不补造验证证据',()=>{
  const value=task();expect(committedMemberHelp(value,'other-run')).toBeUndefined();expect(renderToStaticMarkup(createElement(MemberHelpNotice,{task:value,runId:'other-run'}))).toBe('');
  const otherRun={...value,runIds:['member-run','other-run']};expect(renderToStaticMarkup(createElement(MemberTaskDetail,{...identity,task:otherRun}))).not.toContain('data-testid="member-help"');
  value.help!.input.attemptedToolCallIds=[];const html=renderToStaticMarkup(createElement(MemberHelpNotice,{task:value}));expect(html).toContain('没有登记尝试工具引用');expect(html).toContain('工具引用不是成功证明');expect(html).not.toContain('<button');expect(html).not.toContain('<input');
  expect(Object.keys(memberHelpKindLabels)).toEqual(['missing_input','dependency','permission','capability','scope']);
});
