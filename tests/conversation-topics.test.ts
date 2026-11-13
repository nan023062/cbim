import {expect,it} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import type {GraphSnapshot,ScopeSummary,TaskNode} from '../src/bridge/contracts/dispatch';
import type {RunSummary} from '../src/bridge/contracts/execution';
import {conversationTopics} from '../src/view/conversation/conversation-topics';
import {ConversationTopics} from '../src/view/conversation/ConversationTopics';

const identity={workspaceId:'workspace',rootSessionId:'root'},time='2026-11-14T00:00:00.000Z';
const actor={agentId:'main',agentInstanceId:'main-instance',agentSessionId:'main-channel',name:'主 Agent'};
function scope(scopeId:string,mainRunIds?:string[]):ScopeSummary{return {scopeId,status:'active',createdAt:time,hasGoal:true,hasPlan:false,inputPreview:'话题 '+scopeId,stamp:{scopeId,streamId:'scopes:graph',seq:1},...(mainRunIds?{mainRunIds}:{})}}
function run(runId:string):RunSummary{return {task:{taskId:'root',workspaceId:'workspace',root:'C:/test',goal:'goal',mode:'chat',moduleIds:[],acceptance:[]},runId,status:'completed',acceptance:'not_evaluated',unresolvedTools:[],events:[]}}
function task(taskId:string,scopeId:string):TaskNode{return {kind:'task',nodeId:'task:'+taskId,taskId,scopeId,identity,requester:actor,assignee:{...actor,agentId:'worker',name:'执行员'},modules:[],goal:'派发内容',acceptance:[],revision:1,planRevision:1,status:'queued',awaitedChildren:[],runIds:[],createdAt:time,updatedAt:time}}
function graph(tasks:TaskNode[]):GraphSnapshot{return {version:1,identity,cursor:{...identity,streamId:'graph',seq:1},root:{kind:'session-root',nodeId:'session:root',identity,agent:actor,revision:1,createdAt:time},tasks,agents:[],edges:[]}}

it('迟到的主反馈按持久主运行身份留在原话题，不按列表顺序或当前话题归类',()=>{
  const result=conversationTopics(identity,[scope('next',['new']),scope('original',['start','late'])],[run('start'),run('new'),run('late'),run('old')]);
  expect(result.topics.map(t=>t.runs.map(r=>r.runId))).toEqual([['new'],['start','late']]);expect(result.unassigned.map(r=>r.runId)).toEqual(['old']);
});
it('旧成员回注仅在全部原任务属于同一话题时归类，跨话题或缺任务保留未分类',()=>{
  const feedback=(ids:string[]):RunSummary=>({...run(ids.join('-')),source:{kind:'member-results',continuationId:'return',messageIds:['message'],taskIds:ids}});
  const result=conversationTopics(identity,[scope('one'),scope('two')],[feedback(['a']),feedback(['a','b']),feedback(['missing'])],graph([task('a','one'),task('b','two')]));
  expect(result.topics[0].runs).toHaveLength(1);expect(result.topics[1].runs).toHaveLength(0);expect(result.unassigned).toHaveLength(2);
  expect(conversationTopics(identity,[scope('one')],[feedback(['a'])],{...graph([task('a','one')]),identity:{...identity,rootSessionId:'other'}}).unassigned).toHaveLength(1);
});
it('跨办公室运行不进入本视图，重复归属不任选一个话题',()=>{
  const foreign={...run('foreign'),task:{...run('foreign').task,taskId:'other'}};
  const result=conversationTopics(identity,[scope('one',['same']),scope('two',['same','foreign'])],[run('same'),foreign]);
  expect(result.topics.every(t=>!t.runs.length)).toBe(true);expect(result.conflicts).toEqual(['same']);expect(result.unassigned.map(r=>r.runId)).toEqual(['same']);
});
it('仅已完成和已撤销归入历史；失败及中断仍可见',()=>{
  const summaries:ScopeSummary[]=['completed','cancelled','failed','interrupted'].map((outcome,i)=>({...scope(String(i)),status:'closed',outcome:outcome as ScopeSummary['outcome']}));
  expect(conversationTopics(identity,summaries,[]).topics.map(t=>t.archived)).toEqual([true,true,false,false]);
});
it('主列表不渲染话题正文，历史默认折叠；选中只渲染该话题内容',()=>{
  const result=conversationTopics(identity,[scope('one',['a']),{...scope('two',['b']),status:'closed',outcome:'completed'}],[run('a'),run('b')]);
  const props={...result,onSelect:()=>{},onSelectTask:()=>{},renderRun:(r:RunSummary)=>createElement('p',{key:r.runId},'正文-'+r.runId)};
  const list=renderToStaticMarkup(createElement(ConversationTopics,props));
  expect(list).not.toContain('正文-');expect(list).toContain('<details class="conversation-topic-history">');
  const thread=renderToStaticMarkup(createElement(ConversationTopics,{...props,selectedId:'one'}));
  expect(thread).toContain('正文-a');expect(thread).not.toContain('正文-b');expect(thread).toContain('全部话题');
});
