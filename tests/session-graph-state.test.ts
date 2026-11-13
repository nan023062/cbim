import {expect,it} from 'vitest';
import {SessionGraphProjection} from '../src/frontend/tasks/graph-state';
import {applyGraphBatch} from '../src/logic/tasks/rules/graph-reducer';
import type {GraphEventBatch} from '../src/bridge/contracts/dispatch';

const identity={workspaceId:'workspace',rootSessionId:'main-session'};
const agent={agentId:'cbim:main',agentInstanceId:'main',agentSessionId:'channel',name:'主 Agent'};
const initial:GraphEventBatch={version:1,identity,streamId:'stream',seq:1,eventId:'first',commandId:'open',cause:'graph.created',committedAt:'2026-11-06T00:00:00.000Z',changes:[
  {type:'root.upserted',root:{kind:'session-root',nodeId:'session:main-session',identity,agent,revision:1,createdAt:'2026-11-06T00:00:00.000Z'}},
  {type:'agent.upserted',agent:{agentId:agent.agentId,agentInstanceId:agent.agentInstanceId,name:agent.name,revision:1,state:'idle',waitingTaskIds:[]}},
]};
function fixture(){const state=new SessionGraphProjection(identity),snapshot=applyGraphBatch(undefined,initial);state.apply({mode:'reset',reason:'initial',snapshot,cursor:snapshot.cursor});return {state,snapshot}}
it('no-op polls preserve the graph reference and an atomic delta preserves unchanged root references',()=>{
  const {state,snapshot}=fixture();expect(state.apply({mode:'noop',cursor:snapshot.cursor})).toBe(snapshot);
  const batch:GraphEventBatch={...initial,seq:2,eventId:'second',commandId:'state',cause:'agent.state_changed',changes:[{type:'agent.upserted',agent:{...snapshot.agents[0],revision:2,state:'communicating'}}]};
  const next=state.apply({mode:'delta',from:snapshot.cursor,cursor:{...snapshot.cursor,seq:2},batches:[batch],hasMore:false});
  expect(next.root).toBe(snapshot.root);expect(next.agents[0].state).toBe('communicating');expect(snapshot.agents[0].state).toBe('idle');
  expect(state.apply({mode:'reset',reason:'initial',snapshot:structuredClone(next),cursor:next.cursor})).toBe(next);
  expect(()=>state.apply({mode:'reset',reason:'initial',snapshot,cursor:snapshot.cursor})).toThrow('回退');
  expect(state.snapshot).toBe(next);
});
it('rejects another conversation, gaps and partial commits without changing the trusted graph',()=>{
  const {state,snapshot}=fixture();
  expect(()=>state.apply({mode:'noop',cursor:{...snapshot.cursor,rootSessionId:'other'}})).toThrow('其他会话');
  const second:GraphEventBatch={...initial,seq:2,eventId:'second',commandId:'state',cause:'agent.state_changed',changes:[{type:'agent.upserted',agent:{...snapshot.agents[0],revision:2,state:'communicating'}}]};
  expect(()=>state.apply({mode:'delta',from:snapshot.cursor,cursor:{...snapshot.cursor,seq:4},batches:[second,{...second,seq:4}],hasMore:false})).toThrow();
  expect(state.snapshot).toBe(snapshot);expect(state.cursor?.seq).toBe(1);
  expect(()=>state.apply({mode:'delta',from:{...snapshot.cursor,seq:0},cursor:snapshot.cursor,batches:[second],hasMore:false})).toThrow('断档');
  expect(()=>state.apply({mode:'reset',reason:'initial',snapshot,cursor:{...snapshot.cursor,seq:3}})).toThrow('不一致');
});
