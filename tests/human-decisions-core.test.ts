import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {humanDecisionRequestSchema,humanDecisionPreviewSchema,humanDecisionRecordSchema,scopeHumanDecisionsSchema,humanDecisionHistorySchema,humanDecisionReceiptSchema,humanDecisionCoverageLimitation,type HumanDecisionPreview,type HumanDecisionRecord} from '../src/backend/core/tasks/human-decisions';
import {humanDecisionBasis,humanDecisionProof} from '../src/backend/core/tasks/human-decision-proof';
import {validateHumanDecisions,validateHumanDecisionCommand} from '../src/backend/core/tasks/human-decision-invariants';
import {validateDispatchScopes} from '../src/backend/core/tasks/dispatch-scope-invariants';
import {dispatchScopeGoalSchema} from '../src/backend/core/tasks/scope-goal';
import {emptyScopeSnapshot,summarizeScope,applyScopeBatch,validateScopeSnapshot,readScopeDetail} from '../src/backend/core/tasks/scope-view';
import type {DispatchScope} from '../src/backend/core/tasks/dispatch-scope';
import type {DispatchState,DispatchMutation} from '../src/backend/core/tasks/dispatch-storage';
import type {DispatchRun} from '../src/backend/core/tasks/dispatch-execution';
import type {TaskNode} from '../src/backend/core/tasks/graph-types';

const at='2026-11-07T10:00:00.000Z',digest='a'.repeat(64),otherDigest='b'.repeat(64);
const identity={workspaceId:'workspace',rootSessionId:'root',scopeId:'scope'},graphIdentity={workspaceId:'workspace',rootSessionId:'root'},graphCursor={streamId:'stream',seq:8};
const criterion={id:'human',text:'人工确认页面内容符合目标',kind:'human' as const};
const agent={agentId:'executor',agentInstanceId:'instance',agentSessionId:'session',name:'执行者'},main={agentId:'cbim:main',agentInstanceId:'main-instance',agentSessionId:'main-session',name:'主'};
function preview():HumanDecisionPreview{return {
  identity:{...identity,criterionId:criterion.id},checkedAt:at,decisionRevision:0,
  source:{waitId:'wait',goalRevision:3,inputRevision:1,planRevision:2,reviewRevision:3,reviewRunId:'main-run',reviewLogHash:digest,knowledgeRevision:'knowledge',graphCursor,criterion},
  candidates:[{taskId:'task',taskRevision:3,runId:'member-run',resultId:'result',planRevision:1,logHash:digest,evidenceToolCallIds:['read-1'],agentName:'执行者',summary:'候选摘要',baselines:[{baselineId:'baseline',capturedAt:at,fileCount:1}],selected:{baselineId:'baseline',captureToolCallId:'capture',capturedSeq:10,finishedSeq:11,knowledgeRevision:'knowledge',progressVersion:2,invalidated:false,files:[{relativePath:'app.txt',state:'matches',expected:{byteLength:4,sha256:digest},observed:{byteLength:4,sha256:digest}}]}}],
  allowedDecisions:['accept','reject','request_evidence'],limitations:[humanDecisionCoverageLimitation],issues:[],
}}
function record(value=preview(),patch:Partial<HumanDecisionRecord>={}):HumanDecisionRecord{
  const proof=humanDecisionProof(value);
  return {decisionId:randomUUID(),revision:1,recordedAt:at,actor:{kind:'local_desktop',interaction:'explicit_submit'},criterionId:criterion.id,decision:'accept',comment:'',basis:humanDecisionBasis(proof),baselines:value.candidates.filter(item=>item.selected).map(item=>({taskId:item.taskId,runId:item.runId,baselineId:item.selected!.baselineId})),proof,...patch};
}
function setup(){
  const stamp={runId:'main-run',recordedAt:at,knowledgeRevision:'knowledge',graphCursor},plan={...stamp,revision:2,objective:'实现页面',constraints:[],criteria:[criterion],assignments:[{agentId:agent.agentId,agentName:agent.name,teamId:'team',moduleIds:['module'],moduleNames:['模块'],criterionIds:[criterion.id],reason:'执行页面工作'}],reason:'规划'};
  const review={...stamp,revision:3,planRevision:2,decision:'awaiting_user' as const,checks:[{criterionId:criterion.id,outcome:'needs_human' as const,reason:'等待用户判断',evidence:[{kind:'member-result' as const,taskId:'task',runId:'member-run',resultId:'result',planRevision:1,toolCallIds:['read-1']}]}],superseded:[],gaps:['人工判断'],reason:'请确认',observedSeq:12,lastEffectSeq:0};
  const scope:DispatchScope={...identity,status:'waiting',createdAt:at,goal:{revision:3,input:{message:'实现页面',attachmentIds:[]},plan,review},runTracking:{version:1,mainRunIds:['main-run']},wait:{waitId:'wait',reason:'请确认',createdAt:at,runId:'main-run',goalRevision:3,graphCursor,knowledgeRevision:'knowledge',mainRunIds:['main-run']}};
  const task:TaskNode={kind:'task',nodeId:'task:task',taskId:'task',scopeId:'scope',identity:graphIdentity,requester:main,assignee:agent,modules:[{moduleId:'module',name:'模块',knowledgeRevision:'knowledge',maintenanceBindingId:'maintenance',maintainerPersonIds:['owner'],workflow:{kind:'module',id:'workflow',version:'1'}}],goal:'实现页面',acceptance:[criterion],revision:3,planRevision:1,status:'result_ready',awaitedChildren:[],runIds:['member-run'],result:{resultId:'result',runId:'member-run',planRevision:1,summary:'已交付',evidenceRefs:['read-1'],limitations:[],acceptance:'not_evaluated'},createdAt:at,updatedAt:at};
  const run={binding:{...identity,...agent,taskId:'task',runId:'member-run',planRevision:1},status:'completed',prepared:{knowledgeRevision:'knowledge'}} as unknown as DispatchRun;
  const state:DispatchState={workspaceId:'workspace',scopes:[scope],runs:[run],outbox:[],members:[{workspaceId:'workspace',teamId:'team',agentId:agent.agentId,agentInstanceId:agent.agentInstanceId,executionScopeId:'scope',executionTaskId:'task',lifecycle:'active',leaseEpoch:1,configurationRevision:'knowledge',agentSessionIds:[agent.agentSessionId],activity:'idle',waitingTaskIds:[],communicatingMessageIds:[]}],sessions:[{workspaceId:'workspace',teamId:'team',agentId:agent.agentId,agentInstanceId:agent.agentInstanceId,agentSessionId:agent.agentSessionId,rootSessionId:'root',purpose:'task'}],graphs:[{version:1,identity:graphIdentity,cursor:{...graphIdentity,...graphCursor},root:{kind:'session-root',nodeId:'session:root',identity:graphIdentity,agent:main,revision:1,createdAt:at},tasks:[task],edges:[],agents:[]}]};
  return state;
}
function append(before:DispatchState,item=record()){
  const after=structuredClone(before),scope=after.scopes![0],old=scope.humanDecisions;
  scope.humanDecisions={revision:(old?.revision??0)+1,records:[...(old?.records??[]),item]};
  return {after,mutation:{scopes:[scope],receipt:true} as DispatchMutation};
}
function verify(before:DispatchState,after:DispatchState,mutation:DispatchMutation){validateDispatchScopes(before,after,mutation);validateHumanDecisionCommand(before,mutation,{commandId:'human-decision-'+after.scopes![0].humanDecisions!.records.at(-1)!.decisionId,fingerprint:'fingerprint'})}

it('请求严格拒绝模型actor/证明/路径和未知字段，拒绝及补证须给出意见',()=>{
  const item=record(),request={...identity,criterionId:criterion.id,commandId:item.decisionId,expectedDecisionRevision:0,expectedBasis:item.basis,baselines:item.baselines,decision:'accept',comment:''};
  expect(humanDecisionRequestSchema.safeParse(request).success).toBe(true);
  for(const patch of [{actor:item.actor},{proof:item.proof},{path:'app.txt'},{expectedDecisionRevision:65},{decision:'reject'},{decision:'request_evidence',comment:'  '},{baselines:[...item.baselines,...item.baselines]},{workspaceId:'../foreign'}])expect(humanDecisionRequestSchema.safeParse({...request,...patch}).success).toBe(false);
  expect(humanDecisionRequestSchema.parse({...request,decision:'reject',comment:'  需要修改标题  '}).comment).toBe('需要修改标题');
});

it('依据不受时间/决定序列/候选菜单影响，身份及真实观察变化必失效',()=>{
  const original=preview(),basis=humanDecisionBasis(humanDecisionProof(original)),display=structuredClone(original);
  display.checkedAt='2026-11-08T00:00:00.000Z';display.decisionRevision=10;display.candidates[0].summary='不同预览';display.candidates[0].baselines=[];display.latestDecisionId=randomUUID();
  expect(humanDecisionBasis(humanDecisionProof(display))).toBe(basis);
  for(const mutate of [(value:HumanDecisionPreview)=>{value.identity.scopeId='other'},(value:HumanDecisionPreview)=>{value.source!.criterion={...criterion,text:'新验收项'}},(value:HumanDecisionPreview)=>{value.candidates[0].logHash=otherDigest},(value:HumanDecisionPreview)=>{value.candidates[0].selected!.files[0].state='changed';value.candidates[0].selected!.files[0].observed!.sha256=otherDigest},(value:HumanDecisionPreview)=>{value.limitations.push('成功命令的外部影响不在所选文件内')},(value:HumanDecisionPreview)=>{value.allowedDecisions=['reject','request_evidence']}]){const changed=structuredClone(original);mutate(changed);expect(humanDecisionBasis(humanDecisionProof(changed))).not.toBe(basis)}
});

it('已成功命令的范围限制不等于未知工具结果；接受只覆盖全部显式匹配成果',()=>{
  const value=preview();value.limitations.push('成功的测试命令影响集合无法枚举，未列出的副作用未核实');expect(humanDecisionRecordSchema.safeParse(record(value)).success).toBe(true);
  for(const mutate of [(p:HumanDecisionPreview)=>{p.candidates[0].selected=undefined},(p:HumanDecisionPreview)=>{p.candidates[0].selected!.invalidated=true},(p:HumanDecisionPreview)=>{p.candidates[0].selected!.files[0].state='changed';p.candidates[0].selected!.files[0].observed!.sha256=otherDigest},(p:HumanDecisionPreview)=>{p.candidates[0].selected!.knowledgeRevision='old'},(p:HumanDecisionPreview)=>{p.allowedDecisions=['reject','request_evidence']}]){const changed=preview();mutate(changed);expect(humanDecisionRecordSchema.safeParse(record(changed)).success).toBe(false)}
  const negative=preview();negative.candidates[0].selected=undefined;negative.allowedDecisions=['reject','request_evidence'];expect(humanDecisionRecordSchema.safeParse(record(negative,{decision:'reject',comment:'缺少所需成果'})).success).toBe(true);
  const changed=preview();changed.candidates[0].selected!.files[0].state='missing';delete changed.candidates[0].selected!.files[0].observed;changed.allowedDecisions=['reject','request_evidence'];expect(humanDecisionRecordSchema.safeParse(record(changed,{decision:'request_evidence',comment:'文件已移除，请补充证据'})).success).toBe(true);
});

it('观察矛盾、去掉范围限制、遗漏选择或伪造额外actor均拒绝',()=>{
  const good=record();
  for(const mutate of [(value:HumanDecisionRecord)=>{value.proof.candidates[0].selected!.files[0].observed!.sha256=otherDigest},(value:HumanDecisionRecord)=>{value.proof.limitations=[]},(value:HumanDecisionRecord)=>{value.baselines=[]},(value:HumanDecisionRecord)=>{Object.assign(value.actor,{authenticatedUser:'admin'})},(value:HumanDecisionRecord)=>{value.proof.candidates[0].selected!.finishedSeq=10}]){const changed=structuredClone(good);mutate(changed);expect(humanDecisionRecordSchema.safeParse(changed).success).toBe(false)}
  const empty=preview();empty.candidates=[];expect(humanDecisionPreviewSchema.safeParse(empty).success).toBe(false);
});

it('拒绝时同路径冲突按最大字节数计量，后来的小版本不能降低总核实上限',()=>{
  const value=preview();value.allowedDecisions=['reject','request_evidence'];
  value.candidates[0].selected!.files=Array.from({length:5},(_,i)=>({relativePath:'file-'+i+'.txt',state:'missing',expected:{byteLength:8*1024*1024,sha256:digest}}));
  const smaller=structuredClone(value.candidates[0]);smaller.taskId='task-2';smaller.runId='member-run-2';smaller.resultId='result-2';smaller.selected!.baselineId='baseline-2';smaller.selected!.files.forEach(file=>file.expected.byteLength=1);value.candidates.push(smaller);
  expect(humanDecisionRecordSchema.safeParse(record(value,{decision:'reject',comment:'文件版本不一致'})).success).toBe(false);
  value.candidates.forEach(candidate=>candidate.selected!.files.pop());expect(humanDecisionRecordSchema.safeParse(record(value,{decision:'request_evidence',comment:'请提供一致证据'})).success).toBe(true);
});

it('历史有界连续且只替代同人工项同basis最近一条，旧内容永久保留',()=>{
  const first=record(),second=record(preview(),{revision:2,decision:'reject',comment:'请补内容',supersedesDecisionId:first.decisionId});
  expect(scopeHumanDecisionsSchema.safeParse({revision:2,records:[first,second]}).success).toBe(true);
  for(const records of [[first,{...second,supersedesDecisionId:undefined}],[first,{...second,revision:3}],[first,{...second,decisionId:first.decisionId}]])expect(scopeHumanDecisionsSchema.safeParse({revision:2,records}).success).toBe(false);
  const other=preview();other.limitations.push('另一份当前事实');const third=record(other,{revision:3});expect(scopeHumanDecisionsSchema.safeParse({revision:3,records:[first,second,third]}).success).toBe(true);
  const all:HumanDecisionRecord[]=[];for(let revision=1;revision<=64;revision++)all.push(record(preview(),{revision,...(all.length?{supersedesDecisionId:all.at(-1)!.decisionId}:{})}));
  expect(scopeHumanDecisionsSchema.safeParse({revision:64,records:all}).success).toBe(true);expect(scopeHumanDecisionsSchema.safeParse({revision:65,records:[...all,{...record(),revision:65}]}).success).toBe(false);
  expect(humanDecisionHistorySchema.safeParse({...identity,scopeStatus:'waiting',decisionRevision:0,records:[]}).success).toBe(true);
});

it('回执及历史不能以外层身份掩盖另一会话的决定证明',()=>{
  const item=record(),receipt={...identity,scopeStatus:'waiting',decisionRevision:1,record:item};
  expect(humanDecisionReceiptSchema.safeParse(receipt).success).toBe(true);
  expect(humanDecisionReceiptSchema.safeParse({...receipt,rootSessionId:'other'}).success).toBe(false);
  expect(humanDecisionHistorySchema.safeParse({...identity,scopeStatus:'closed',decisionRevision:1,records:[item]}).success).toBe(true);
  expect(humanDecisionHistorySchema.safeParse({...identity,scopeId:'other',scopeStatus:'closed',decisionRevision:1,records:[item]}).success).toBe(false);
});

it('安全waiting只追加独立记录，不消费等待或改变目标图，重放使用同一校验',()=>{
  const before=setup(),saved=append(before);verify(before,saved.after,saved.mutation);
  expect(saved.after.scopes![0].goal).toEqual(before.scopes![0].goal);expect(saved.after.scopes![0].wait).toEqual(before.scopes![0].wait);expect(saved.after.graphs).toEqual(before.graphs);expect(saved.after.runs).toEqual(before.runs);
  expect(()=>validateHumanDecisions(saved.after,saved.after,{receipt:true})).not.toThrow();
  const first=saved.after.scopes![0].humanDecisions!.records[0],second=append(saved.after,record(preview(),{revision:2,supersedesDecisionId:first.decisionId,decision:'request_evidence',comment:'需要补充说明'}));verify(saved.after,second.after,second.mutation);
});

it('普通事务不能夹带人工决定修改图/预算/运行/等待，active与closed不能追加',()=>{
  const before=setup();
  for(const patch of [{batch:{}},{runs:[before.runs![0]]},{members:[before.members[0]]},{sessions:[before.sessions[0]]},{messages:[{}]}]){const saved=append(before);expect(()=>validateHumanDecisions(before,saved.after,{...saved.mutation,...patch} as DispatchMutation)).toThrow()}
  for(const mutate of [(scope:DispatchScope)=>{scope.goal!.blocked={reason:'改写',at}},(scope:DispatchScope)=>{scope.wait!.reason='改写'},(scope:DispatchScope)=>{scope.budget={version:1,policy:{revision:1,enabled:false,limits:{}}}},(scope:DispatchScope)=>{scope.status='active'}]){const saved=append(before);mutate(saved.after.scopes![0]);expect(()=>validateHumanDecisions(before,saved.after,saved.mutation)).toThrow()}
  for(const status of ['active','closed'] as const){const invalid=setup();invalid.scopes![0].status=status;const saved=append(invalid);expect(()=>validateHumanDecisions(invalid,saved.after,saved.mutation)).toThrow()}
  const saved=append(before);expect(()=>validateHumanDecisionCommand(before,saved.mutation,{commandId:'model-tool',fingerprint:'x'})).toThrow();
});

it('拒绝旧basis、跨身份、候选遗漏、错误运行与不属验收项的证据',()=>{
  for(const mutate of [(state:DispatchState)=>{state.graphs[0].cursor.seq++},(state:DispatchState)=>{state.scopes![0].goal!.revision++},(state:DispatchState)=>{state.scopes![0].goal!.plan!.assignments[0].criterionIds=['other']},(state:DispatchState)=>{state.graphs[0].tasks[0].result!.evidenceRefs=[]},(state:DispatchState)=>{state.runs![0].status='failed'},(state:DispatchState)=>{state.runs![0].binding.rootSessionId='other'},(state:DispatchState)=>{state.runs![0].prepared.knowledgeRevision='new'},(state:DispatchState)=>{state.graphs[0].tasks[0].revision++},(state:DispatchState)=>{state.scopes![0].goal!.review!.checks[0].evidence.push({kind:'member-result',taskId:'other',runId:'other-run',resultId:'other-result',planRevision:1,toolCallIds:['other']})}]){const before=setup();mutate(before);const saved=append(before);expect(()=>validateHumanDecisions(before,saved.after,saved.mutation)).toThrow()}
  const before=setup(),wrong=record();wrong.proof.identity.scopeId='other';wrong.basis=humanDecisionBasis(wrong.proof);const saved=append(before,wrong);expect(()=>validateHumanDecisions(before,saved.after,saved.mutation)).toThrow();
});

it('追加后不能改删旧意见或伪造hash，也不能跨周期复用command',()=>{
  const original=setup(),saved=append(original);verify(original,saved.after,saved.mutation);
  for(const mutate of [(state:DispatchState)=>{delete state.scopes![0].humanDecisions},(state:DispatchState)=>{state.scopes![0].humanDecisions!.records[0].comment='后来修改'},(state:DispatchState)=>{state.scopes![0].humanDecisions!.records[0].proof.candidates[0].logHash=otherDigest}]){const changed=structuredClone(saved.after);mutate(changed);expect(()=>validateHumanDecisions(saved.after,changed,{scopes:changed.scopes,receipt:true})).toThrow()}
  const same=structuredClone(saved.after);same.scopes!.push({...same.scopes![0],scopeId:'other'});expect(()=>validateHumanDecisions(saved.after,same,{scopes:[same.scopes![1]],receipt:true})).toThrow();
  const overlap=setup(),item=record();overlap.scopes!.push({...overlap.scopes![0],scopeId:item.decisionId,recovery:{recoveryId:item.decisionId} as never});const added=append(overlap,item);expect(()=>validateHumanDecisions(overlap,added.after,added.mutation)).toThrow();
});

it('既有人工决定随封存保留，但不能让模型将人工项satisfied或complete',()=>{
  const before=setup(),saved=append(before);verify(before,saved.after,saved.mutation);
  const closed=structuredClone(saved.after);closed.scopes![0]={...closed.scopes![0],status:'closed',outcome:'cancelled',closedAt:at};closed.members[0]={...closed.members[0],lifecycle:'released',releasedAt:at,leaseEpoch:2};
  expect(()=>validateDispatchScopes(saved.after,closed,{scopes:closed.scopes,members:closed.members,receipt:true})).not.toThrow();expect(closed.scopes![0].humanDecisions).toEqual(saved.after.scopes![0].humanDecisions);
  const goal=structuredClone(saved.after.scopes![0].goal!);goal.review!.checks[0].outcome='satisfied';expect(dispatchScopeGoalSchema.safeParse(goal).success).toBe(false);goal.review!.decision='complete';goal.review!.gaps=[];expect(dispatchScopeGoalSchema.safeParse(goal).success).toBe(false);
});

it('人工历史只推进scope摘要与选中详情，旧无记录不补造',()=>{
  const before=setup(),saved=append(before),empty=emptyScopeSnapshot(graphIdentity,'stream');
  const first=applyScopeBatch(empty,{identity:graphIdentity,streamId:empty.cursor.streamId,seq:1,scopes:[summarizeScope(before.scopes![0],empty.cursor.streamId,1)]});
  expect(first.scopes[0].humanDecisions).toBeUndefined();
  const second=applyScopeBatch(first,{identity:graphIdentity,streamId:first.cursor.streamId,seq:2,scopes:[summarizeScope(saved.after.scopes![0],first.cursor.streamId,2)]});validateScopeSnapshot(second);
  expect(second.scopes[0].humanDecisions).toEqual({revision:1,count:1,lastDecisionAt:at});expect(second.scopes[0].goalRevision).toBe(first.scopes[0].goalRevision);
  const detail=readScopeDetail(second,saved.after.scopes!,undefined,first.scopes[0].stamp);expect(detail.mode).toBe('updated');if(detail.mode!=='updated')throw Error('detail');expect(detail.scope.humanDecisions).toEqual(saved.after.scopes![0].humanDecisions);detail.scope.humanDecisions!.records[0].comment='客户端副本';expect(saved.after.scopes![0].humanDecisions!.records[0].comment).toBe('');
  const invalid=structuredClone(second);invalid.scopes[0].humanDecisions!.count++;expect(()=>validateScopeSnapshot(invalid)).toThrow();
});
