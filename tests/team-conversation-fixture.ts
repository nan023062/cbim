import type {GraphSnapshot,TaskNode,TeamSession} from '../src/bridge/contracts/dispatch';

export const officeIdentity={workspaceId:'workspace',rootSessionId:'root'},officeTime='2026-11-14T00:00:00.000Z';
const main={agentId:'main',agentInstanceId:'main-instance',agentSessionId:'main-channel',name:'主 Agent'};
export function officeSession(agentId='worker',sessionId='worker-session'):TeamSession{return {...officeIdentity,teamId:'team',agentId,sessionId,createdAt:officeTime}}
export function officeTask(taskId:string,scopeId='topic'):TaskNode{return {identity:officeIdentity,kind:'task',nodeId:'task:'+taskId,taskId,scopeId,requester:main,assignee:{agentId:'worker',agentInstanceId:taskId+'-instance',agentSessionId:taskId+'-channel',name:'建模员'},goal:'搭建模块 '+taskId,modules:[],acceptance:[],revision:1,planRevision:1,status:'queued',awaitedChildren:[],runIds:[],createdAt:officeTime,updatedAt:officeTime}}
export function officeGraph(tasks:TaskNode[]=[]):GraphSnapshot{return {version:1,identity:officeIdentity,cursor:{...officeIdentity,streamId:'graph',seq:1},root:{kind:'session-root',nodeId:'session:root',identity:officeIdentity,agent:main,revision:1,createdAt:officeTime},agents:[{agentId:'worker',agentInstanceId:'worker-instance',name:'建模员',revision:1,state:'idle',waitingTaskIds:[]}],tasks,edges:[]}}
