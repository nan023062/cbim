import {expect,test} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {layoutDispatchGraph,GRAPH_NODE_WIDTH,GRAPH_NODE_HEIGHT} from '../src/view/tasks/graph-layout';
import {DispatchGraph} from '../src/view/tasks/DispatchGraph';
import {SessionTaskView,sessionRoot} from '../src/view/tasks/SessionTaskView';
import {MemberActivity} from '../src/view/tasks/MemberActivity';
import {MemberTaskDetail} from '../src/view/tasks/MemberTaskDetail';
import type {GraphSnapshot,TaskNode,GraphEdge} from '../src/bridge/contracts/dispatch';

const identity={workspaceId:'workspace',rootSessionId:'root'},time='2026-11-06T10:00:00.000Z';
const main={agentId:'cbim:main',agentInstanceId:'main-instance',agentSessionId:'main-session',name:'主 Agent'};
const member={agentId:'dev',agentInstanceId:'dev-instance',agentSessionId:'dev-session',name:'开发成员'};
const task=(id:string):TaskNode=>({kind:'task',nodeId:'task:'+id,taskId:id,identity,requester:main,assignee:member,modules:[{moduleId:'web',name:'网页模块',knowledgeRevision:'k1',maintenanceBindingId:'m1',maintainerPersonIds:['p1'],workflow:{kind:'general',id:'cbim:general',version:'1',reason:'无专用流程'}}],goal:'实现功能 '+id,acceptance:[{id:'a1',text:'验证可运行'}],revision:1,planRevision:1,status:'queued',awaitedChildren:[],runIds:[],createdAt:time,updatedAt:time});
const dispatch=(id:string):GraphEdge=>({edgeId:'dispatch-'+id,identity,fromNodeId:'session:root',toNodeId:'task:'+id,revision:1,enabled:true,kind:'dispatch'});
function graph():GraphSnapshot{return {version:1,identity,cursor:{...identity,streamId:'stream',seq:1},root:{kind:'session-root',nodeId:'session:root',identity,agent:main,revision:1,createdAt:time},tasks:[task('a'),{...task('b'),status:'waiting',waitReason:'等待功能 a 的交付候选'}],edges:[dispatch('a'),dispatch('b'),{edgeId:'dependency',identity,fromNodeId:'task:a',toNodeId:'task:b',revision:1,enabled:true,kind:'dependency',condition:{kind:'result_ready',planRevision:1}}],agents:[]}}

test('layout retains real nodes and routes every active dispatch/dependency forward without overlapping cards',()=>{
  const input=graph(),layout=layoutDispatchGraph(input,input.root.nodeId),positions=new Map(layout.nodes.map(node=>[node.nodeId,node]));
  expect(layout.nodes).toHaveLength(3);expect(layout.edges).toHaveLength(3);
  expect(positions.get('task:a')!.rank).toBe(1);expect(positions.get('task:b')!.rank).toBe(2);
  for(const {edge,path} of layout.edges){const from=positions.get(edge.fromNodeId)!,to=positions.get(edge.toNodeId)!;expect(to.y).toBeGreaterThan(from.y+from.height);expect(path).toMatch(/^M /);expect(path).toContain(String(to.y))}
  for(let a=0;a<layout.nodes.length;a++)for(let b=a+1;b<layout.nodes.length;b++){
    const x=layout.nodes[a],y=layout.nodes[b];expect(x.x+x.width<=y.x||y.x+y.width<=x.x||x.y+x.height<=y.y||y.y+y.height<=x.y).toBe(true);
  }
  expect(layout.nodes.every(node=>node.width===GRAPH_NODE_WIDTH&&node.height===GRAPH_NODE_HEIGHT)).toBe(true);
});

test('status updates retain all coordinates and new same-rank tasks append without moving previous nodes',()=>{
  const input=graph(),first=layoutDispatchGraph(input,input.root.nodeId);
  const updated=structuredClone(input);updated.tasks[0].status='running';updated.tasks[0].goal='更长的目标，仅改变显示文字';updated.tasks.reverse();
  expect(layoutDispatchGraph(updated,input.root.nodeId,first).nodes).toEqual(first.nodes);
  updated.tasks.push({...task('0-earlier'),createdAt:'2026-11-05T10:00:00.000Z'});updated.edges.push(dispatch('0-earlier'));
  const appended=layoutDispatchGraph(updated,input.root.nodeId,first);
  for(const old of first.nodes)expect(appended.nodes.find(node=>node.nodeId===old.nodeId)).toEqual(old);
  expect(appended.nodes.find(node=>node.taskId==='0-earlier')!.x).toBeGreaterThan(appended.nodes.find(node=>node.taskId==='a')!.x);
});

test('disabled edges do not constrain layout and invalid cycles or missing references are explicit errors',()=>{
  const input=graph();input.edges[2].enabled=false;
  const layout=layoutDispatchGraph(input,input.root.nodeId);expect(layout.edges).toHaveLength(2);expect(layout.nodes.find(node=>node.taskId==='b')!.rank).toBe(1);
  input.edges[2].enabled=true;input.edges.push({...input.edges[2],edgeId:'back',fromNodeId:'task:b',toNodeId:'task:a'});
  expect(()=>layoutDispatchGraph(input,input.root.nodeId)).toThrow('循环');
  input.edges.pop();input.edges[2].fromNodeId='missing';expect(()=>layoutDispatchGraph(input,input.root.nodeId)).toThrow('缺少端点');
});

test('render shows selectable agent/module/goal/status nodes and differently styled directed relations',()=>{
  const input=graph(),root=sessionRoot([],identity.rootSessionId,0,input);
  const html=renderToStaticMarkup(createElement(DispatchGraph,{graph:input,root,selectedTaskId:'b',onSelectTask:()=>{}}));
  expect(html.match(/data-testid="dispatch-task-node"/g)).toHaveLength(2);expect(html).toContain('data-testid="dispatch-root-node"');
  expect(html).toContain('网页模块');expect(html).toContain('开发成员');expect(html).toContain('等待功能 a 的交付候选');expect(html).toContain('交付待审阅表示候选结果');
  expect(html).toContain('data-kind="dependency"');expect(html).toContain('data-kind="dispatch"');expect(html).toContain('marker-end="url(');expect(html).toContain('aria-pressed="true"');
  expect(html).not.toContain('scale(');expect(html).toContain('可滚动查看全部节点');
});

test('unbuilt graphs keep only the real conversation root and mismatched workspace snapshots never render',()=>{
  const props={workspaceId:'workspace',taskId:'root',runs:[],queued:[],now:0,busy:false,onQueueChange:()=>{},onQueueContinue:()=>{},onChat:()=>{},onStop:()=>{}};
  const empty=renderToStaticMarkup(createElement(SessionTaskView,props));expect(empty).toContain('dispatch-root-node');expect(empty).not.toContain('dispatch-task-node');expect(empty).toContain('尚未派发成员任务');
  const foreign=graph();foreign.identity={...identity,workspaceId:'other'};foreign.tasks[0].goal='FOREIGN_SENTINEL';
  const rejected=renderToStaticMarkup(createElement(SessionTaskView,{...props,graph:foreign}));expect(rejected).toContain('身份不匹配');expect(rejected).not.toContain('FOREIGN_SENTINEL');
  const draft=renderToStaticMarkup(createElement(SessionTaskView,{...props,taskId:undefined}));expect(draft).toContain('尚未开始会话');expect(draft).not.toContain('dispatch-root-node');
});

test('任务图和动态卡始终将业务任务显示为独立执行 Agent，不提供主角色自执行标识',()=>{
  const input=graph();input.tasks[0].assignee={agentId:'cbim:executor',agentInstanceId:'default-instance',agentSessionId:'default-channel',name:'默认执行 Agent'};
  const root=sessionRoot([],identity.rootSessionId,0,input);
  const html=renderToStaticMarkup(createElement(DispatchGraph,{graph:input,root,onSelectTask:()=>{}}));expect(html).toContain('执行 Agent');expect(html).not.toContain('自执行');
  const cards=renderToStaticMarkup(createElement(MemberActivity,{workspaceId:identity.workspaceId,rootSessionId:identity.rootSessionId,tasks:input.tasks,onSelectTask:()=>{}}));expect(cards).toContain('执行 Agent');expect(cards).not.toContain('自执行');
  const details=renderToStaticMarkup(createElement(MemberTaskDetail,{workspaceId:identity.workspaceId,rootSessionId:identity.rootSessionId,task:input.tasks[0]}));expect(details).toContain('执行 Agent');expect(details).toContain('default-channel');expect(details).toContain('default-instance');expect(details).not.toContain('自执行');
});
