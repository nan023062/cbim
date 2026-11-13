// Renderer-only inspection fixture, not a backend/model acceptance test. Every IPC stays in memory.
import React from 'react';
import {createRoot} from 'react-dom/client';
import '../src/view/shell/shell.css';
import {progressFixture,progressMemberRun,progressIdentity,progressTime} from '../tests/conversation-progress-fixture';
import {inlineMainRuns} from '../tests/inline-conversation-fixture';
import {summarizeScope} from '../src/logic/tasks/rules/scope-view';
const id=progressIdentity.workspaceId,profileId='11111111-1111-4111-8111-111111111111',instanceId='33333333-3333-4333-8333-333333333333';
const entry={id,name:'办公室验收夹具',path:'C:/isolated-office-fixture',state:'running',instanceId,tasks:[],revision:'revision'};
const fixture=(window as any).fixture={marker:'office-team-v1',phase:3,calls:[],unexpected:[],errors:[],queued:[]};
window.addEventListener('error',event=>fixture.errors.push(event.message));
window.addEventListener('unhandledrejection',event=>fixture.errors.push(String(event.reason)));
function otherOffice<T>(value:T):T{
  const ids=new Set(['root','scope-one','history','member-1','member-2','next-rules','more-rules','historical','main-run','returned-run','member-1-run','member-2-run','member-1-session','member-2-session','executor-logical','designer-logical']);
  return JSON.parse(JSON.stringify(value),(_key,v)=>typeof v==='string'?(ids.has(v)?v+'-two':v.startsWith('task:')||v==='session:root'?v+'-two':v):v);
}
function data(root='root'){
  const phase=fixture.phase,value=progressFixture(Math.min(phase,4)),runs=inlineMainRuns(Math.min(phase,4));
  for(const run of runs)run.sessionFile='C:/isolated-office-fixture/session.jsonl';
  const mainIds=runs.map(run=>run.runId);value.scope.runTracking={version:1,mainRunIds:mainIds};
  value.scope.goal!.inputRevision=1;value.scope.goal!.plan!.inputRevision=1;
  const second=value.graph.tasks[1];second.assignee.agentId='designer';second.modules[0]={...second.modules[0],moduleId:'board',name:'棋盘界面'};
  value.graph.agents[2].agentId='designer';
  const historical={...structuredClone(value.graph.tasks[0]),taskId:'historical',nodeId:'task:historical',goal:'已撤销的探索任务',scopeId:'history',status:'cancelled' as const,activeRunId:undefined,runIds:[],result:undefined};value.graph.tasks.push(historical);
  if(phase>=4)value.graph.tasks.push({...structuredClone(value.graph.tasks[0]),taskId:'next-rules',nodeId:'task:next-rules',goal:'补充规则测试',status:'queued',activeRunId:undefined,runIds:[],result:undefined});
  if(phase>=5)value.graph.tasks.push({...structuredClone(value.graph.tasks[0]),taskId:'more-rules',nodeId:'task:more-rules',goal:'规则边界验证',status:'queued',activeRunId:undefined,runIds:[],result:undefined});
  value.graph.cursor.seq=phase+1;
  for(const task of value.graph.tasks)if(!value.graph.edges.some(edge=>edge.kind==='dispatch'&&edge.toNodeId===task.nodeId))value.graph.edges.push({edgeId:'dispatch-'+task.taskId,identity:value.identity,kind:'dispatch',fromNodeId:value.graph.root.nodeId,toNodeId:task.nodeId,revision:1,enabled:true});
  const oldScope={...structuredClone(value.scope),scopeId:'history',status:'closed' as const,outcome:'cancelled' as const,closedAt:progressTime,runTracking:undefined,goal:undefined};
  const sessions=['executor','designer'].map(agentId=>({...value.identity,agentId,teamId:'team',sessionId:agentId+'-logical',createdAt:progressTime}));
  const result={...value,scopes:[oldScope,value.scope],sessions,runs};
  if(root==='root')return result;
  // Both offices use the same roles but distinct roots, topic/task/run/session identities.
  return otherOffice(result);
}
(window as any).cbim={call:async(action:string,args:any={})=>{
  fixture.calls.push({action,args});const value=data(args.identity?.rootSessionId??args.rootSessionId??args.taskId??'root'),runs=value.runs;
  if(action==='list')return {entries:[entry]};if(action==='open')return entry;
  if(action==='snapshot')return {workspaceId:id,instanceId,revision:'revision',files:[]};
  if(action==='loop.list')return ['root','root-two'].flatMap(root=>data(root).runs.slice(0,1).map(({task,runId,status}:any)=>({task:{...task,goal:root==='root'?'象棋研发办公室':'独立办公室二'},runId,status})));
  if(action==='runtime.snapshot')return {workspaces:[{workspaceId:id,availability:'ready'}],runs:[]};
  if(action==='loop.threadView')return {runs,issues:[],resumeRunId:runs.at(-1).runId};
  if(action==='loop.approvals'||action==='loop.questions')return [];
  if(action==='loop.queueDelta')return {epoch:'22222222-2222-4222-8222-222222222222',revision:fixture.queued.length+1,reset:true,order:fixture.queued.filter((v:any)=>v.taskId===args.taskId).map((v:any)=>v.id),upserts:fixture.queued.filter((v:any)=>v.taskId===args.taskId).map((item:any)=>({version:fixture.queued.length+1,item}))};
  if(action==='dispatch.sessionRead'){
    const seq=fixture.phase+1,cursor={...value.identity,kind:'scopes',streamId:'scopes:graph',seq};
    const summaries=value.scopes.map((scope:any)=>summarizeScope(scope,cursor.streamId,seq));
    const scope=value.scopes.find((scope:any)=>scope.scopeId===args.scopeId)??value.scope,summary=summaries.find((s:any)=>s.scopeId===scope.scopeId)!;
    return {graph:{mode:'reset',reason:'initial',snapshot:value.graph,cursor:value.graph.cursor},scopes:{mode:'reset',reason:'initial',snapshot:{identity:value.identity,cursor,scopes:summaries},cursor},detail:{mode:'updated',stamp:summary.stamp,scope},teamSessions:value.sessions};
  }
  if(action==='dispatch.executionEvents'){const record=progressMemberRun(args.taskId.replace(/-two$/,''),Math.min(fixture.phase,4));const {events,...run}=args.rootSessionId==='root-two'?otherOffice(record):record;return {mode:'reset',run,cursor:{runId:run.runId,seq:events.length},events,hasMore:false}}
  if(action==='agent.mainSettings')return {workspaceId:id,instanceId,agentId:'cbim:main',revision:1,selection:{engine:'pi',profileId,modelId:'fixture'}};
  if(action==='models.list')return {profiles:[{id:profileId,name:'隔离模型夹具',api:'openai-completions',baseUrl:'http://127.0.0.1:1',auth:'none',defaultModel:'fixture',models:[{id:'fixture',name:'fixture',enabled:true,contextWindow:10000,maxTokens:1000,reasoning:false}],hasKey:false}],secureStorage:true};
  if(action==='loop.enqueue'){fixture.queued.push({id:crypto.randomUUID(),taskId:args.taskId,message:args.message,options:{...args.options,provider:'cbim-'+profileId},status:'pending'});return fixture.queued.at(-1)}
  if(action==='resources.status')return {source:'local',session:{state:'signedOut'}};
  if(action==='desktop.updates.status')return {currentVersion:'0.1.2',enabled:false,phase:'disabled'};
  if(action==='admission.read')return {kind:'snapshot',snapshot:{cursor:{streamId:'fixture',revision:1},policy:{revision:1,maxConcurrentRuns:4},occupied:[],waiting:[]}};
  fixture.unexpected.push(action);throw Error('Unexpected fixture IPC '+action);
}};
const {App}=await import('../src/view/shell/App');
createRoot(document.getElementById('root')!).render(<App/>);
