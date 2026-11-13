import type {TaskNode} from '../../src/bridge/contracts/dispatch';
export const identity={workspaceId:'workspace',rootSessionId:'root'},time='2026-11-13T00:00:00.000Z';
export const binding={...identity,scopeId:'scope',runId:'main-run'};
export function candidate():TaskNode{
  const main={agentId:'cbim:main',agentInstanceId:'main-instance',agentSessionId:'main-session',name:'主 Agent'},member={agentId:'member',agentInstanceId:'member-instance',agentSessionId:'member-session',name:'执行成员'};
  return {kind:'task',nodeId:'task:task',taskId:'task',identity:{...identity},scopeId:'scope',requester:main,assignee:member,modules:[{moduleId:'module',name:'模块',knowledgeRevision:'knowledge',maintenanceBindingId:'owner',maintainerPersonIds:['person'],workflow:{kind:'general',id:'general',version:'1',reason:'默认'}}],goal:'核实产物',acceptance:[{id:'criterion',text:'真实证据'}],revision:4,planRevision:1,status:'result_ready',runIds:['member-run'],awaitedChildren:[],createdAt:time,updatedAt:time,result:{resultId:'result',runId:'member-run',planRevision:1,summary:'已交付候选',evidenceRefs:['read'],limitations:[],acceptance:'not_evaluated'}};
}
export const request={taskId:'task',expectedRevision:4,resultId:'result',decision:'accept' as const,reason:'核对工具证据'};
export function approved():TaskNode{return {...candidate(),revision:5,candidateReview:{resultId:'result',runId:'member-run',planRevision:1,mainRunId:binding.runId,decision:'accept',reason:request.reason,recordedAt:time}}}
