import {it,expect,vi} from 'vitest';
import {hash,json} from '../src/backend/core/foundation/serialization';
import {jsonToolResult} from '../src/backend/core/tools/results';
import type {ToolReceipt} from '../src/backend/core/tools/types';
import {toolReceipt} from '../src/backend/core/tools/receipts';
import type {ArtifactEvidenceEvent} from '../src/backend/core/tasks/artifact-evidence';
import {artifactSources} from '../src/backend/core/tasks/artifact-evidence';
import type {ArtifactBaselineStaged} from '../src/backend/core/tasks/artifact-baseline';
import {memberCheckpointInputSchema,memberCheckpointProofSchema,isMemberCheckpointPending,type MemberCheckpointStaged} from '../src/backend/core/tasks/member-checkpoint';
import {MemberCheckpointTools} from '../src/backend/core/tasks/member-checkpoint-tools';
import {validateCheckpointEligibility,verifyMemberCheckpoint} from '../src/backend/core/tasks/member-checkpoint-evidence';

const binding={workspaceId:'workspace',teamId:'team',agentId:'executor',agentInstanceId:'instance',agentSessionId:'session',rootSessionId:'root',taskId:'task',runId:'first-run',leaseEpoch:1,planRevision:1},stamp='2026-11-07T00:00:00.000Z',normalize=(path:string)=>path.replace(/^\/workspace\//,'');
const input={expectedTaskProgressVersion:1,baselineId:'baseline',reason:'暂存局部修改，交回主调度安排'};
function append(events:ArtifactEvidenceEvent[],type:string,data:Record<string,unknown>){const event={seq:events.length+1,type,data,workspaceId:binding.workspaceId,taskId:binding.taskId,runId:binding.runId};events.push(event);return event}
function start(events:ArtifactEvidenceEvent[],id:string,name:string,input:Record<string,unknown>,effects:ToolReceipt['effects']=['maintenance']){append(events,'tool.proposed',{id,name,input});return append(events,'tool.allowed',{id,name,input,effects,scope:{kind:'workspace',workspaceId:binding.workspaceId}})}
function finish(events:ArtifactEvidenceEvent[],allowed:ArtifactEvidenceEvent,result:unknown,outcome:ToolReceipt['outcome']='succeeded'){
  const call=allowed.data,receipt:ToolReceipt={version:1,toolCallId:String(call.id),toolName:String(call.name),workspaceId:binding.workspaceId,taskId:binding.taskId,runId:binding.runId,inputHash:hash(JSON.stringify(call.input)),resultHash:hash(JSON.stringify(result)),scope:call.scope as ToolReceipt['scope'],effects:call.effects as ToolReceipt['effects'],outcome,recordedAt:stamp};
  return append(events,'tool.finished',{id:call.id,name:call.name,result,isError:outcome==='failed',receipt});
}
function fixture(beforeCapture?:(events:ArtifactEvidenceEvent[])=>void){
  const events:ArtifactEvidenceEvent[]=[];append(events,'run.started',{memberBinding:binding,task:{workspaceId:binding.workspaceId,taskId:binding.taskId,agentId:binding.agentId,goal:'原目标'}});append(events,'task.updated',{progress:{version:1,state:'executing',goal:'原目标',acceptance:['验证'],steps:[{id:'s',title:'工作',state:'pending',evidence:[]}]}});
  const read=start(events,'read-source','read',{path:'/workspace/file.txt'},['read']);finish(events,read,jsonToolResult('read',{text:'bytes'}));beforeCapture?.(events);
  const captureInput={expectedTaskProgressVersion:1,sourceToolCallIds:['read-source']},capture=start(events,'capture','cbim_task_artifact_capture',captureInput),sources=artifactSources(events,binding,['read-source']);
  const baseline:ArtifactBaselineStaged={version:1,baselineId:'baseline',captureToolCallId:'capture',binding,knowledgeRevision:'knowledge',progressVersion:1,capturedAt:stamp,lastEffectSeq:sources.lastEffectSeq,sourceCalls:sources.sources.map(({path:_,...source})=>source),files:[{relativePath:'file.txt',byteLength:5,sha256:hash('bytes'),sourceToolCallIds:['read-source']}]};
  append(events,'artifact.baseline_captured',{baseline});finish(events,capture,jsonToolResult('cbim_task_artifact_capture',{state:'captured',baseline}));return {events,baseline};
}
function checkpoint(events:ArtifactEvidenceEvent[]){const allowed=start(events,'checkpoint','cbim_task_checkpoint',input),staged:MemberCheckpointStaged={version:1,checkpointId:'checkpoint-one',toolCallId:'checkpoint',binding,input,knowledgeRevision:'knowledge',requestedAt:stamp,lastEffectSeq:artifactSources(events,binding,['read-source']).lastEffectSeq};append(events,'task.checkpoint_requested',{checkpoint:staged});finish(events,allowed,jsonToolResult('cbim_task_checkpoint',{state:'staged',checkpoint:staged}));append(events,'run.settled',{status:'completed'});return staged}
const verify=(events:ArtifactEvidenceEvent[])=>verifyMemberCheckpoint(events,binding,'knowledge',normalize);

it('只有完整来源、结构化请求、成功工具回执和正常终态共同形成检查点，公开记录不含私有指纹',()=>{
  const {events}=fixture(),eligible=validateCheckpointEligibility(events,binding,'knowledge',normalize,input);expect(eligible.baseline.baseline.baselineId).toBe('baseline');checkpoint(events);const snapshot=structuredClone(events),result=verify(events)!;
  expect(result.checkpoint).toMatchObject({checkpointId:'checkpoint-one',binding,input});expect(result.checkpoint.requestedSeq).toBeLessThan(result.checkpoint.finishedSeq);expect(result.checkpoint.finishedSeq).toBeLessThan(result.checkpoint.terminalSeq);expect(result.logHash).toBe(hash(json(events)));expect(result.checkpoint).not.toHaveProperty('logHash');expect(events).toEqual(snapshot);
  expect(memberCheckpointProofSchema.safeParse({...result,native:{byteLength:100,sha256:hash('native')}}).success).toBe(true);
});
it('完整路径包括输入文件；同路径此前成功写入可覆盖，命令/目录/外部及放行失败不能用相同hash洗白',()=>{
  const same=fixture(events=>{finish(events,start(events,'write','write',{path:'file.txt',content:'bytes'},['business-write']),jsonToolResult('write',{ok:true}))});expect(()=>validateCheckpointEligibility(same.events,binding,'knowledge',normalize,input)).not.toThrow();
  for(const [name,args,effect,outcome] of [
    ['read',{path:'other.txt'},'read','succeeded'],['write',{path:'other.txt',content:'x'},'business-write','succeeded'],['write',{path:'file.txt',content:'x'},'business-write','failed'],
    ['grep',{pattern:'x',path:'.'},'read','succeeded'],['find',{pattern:'*'},'read','succeeded'],['ls',{path:'.'},'read','succeeded'],['bash',{command:'echo ok'},'command','succeeded'],['plugin_fetch',{url:'https://example.test'},'read','succeeded'],['cbim_knowledge_query',{query:'x'},'read','succeeded'],
  ] as const){const f=fixture(events=>finish(events,start(events,'unsupported',name,args,[effect]),jsonToolResult(name,{ok:true}),outcome));expect(()=>validateCheckpointEligibility(f.events,binding,'knowledge',normalize,input)).toThrow()}
});
it('真实仓库只读范围即使有完整本地文件基线，也不能建立原成员续执行检查点',()=>{
  const f=fixture(events=>{
    const allowed=start(events,'repository','cbim_repository_get',{connectorId:'.cbim/connectors/resources',expectedRevision:'a'.repeat(64),resourceId:'30000000-0000-0000-0000-000000000001'},['read']);
    allowed.data.scope={kind:'repository',workspaceId:binding.workspaceId,connectorId:'.cbim/connectors/resources',repositoryId:'10000000-0000-0000-0000-000000000001',connectionId:'20000000-0000-0000-0000-000000000001',operation:'get'};
    finish(events,allowed,jsonToolResult('cbim_repository_get',{reference:'资料'}));
  });
  expect(f.baseline.files).toHaveLength(1);
  expect(()=>validateCheckpointEligibility(f.events,binding,'knowledge',normalize,input)).toThrow();
});
it('进度/知识/基线变化及交付、求助、重复检查点不能建立新的安全资格',()=>{
  const mutations:Array<(events:ArtifactEvidenceEvent[])=>void>=[events=>append(events,'task.updated',{progress:{version:2,state:'executing'}}),(events:ArtifactEvidenceEvent[])=>append(events,'task.updated',{progress:{version:1,state:'awaiting_review',delivery:{summary:'已交付'}}}),(events:ArtifactEvidenceEvent[])=>append(events,'task.help_requested',{help:{}}),(events:ArtifactEvidenceEvent[])=>append(events,'task.checkpoint_requested',{checkpoint:{}}),(events:ArtifactEvidenceEvent[])=>append(events,'run.stop_requested',{}),(events:ArtifactEvidenceEvent[])=>append(events,'run.interrupted',{}),(events:ArtifactEvidenceEvent[])=>{const a=start(events,'later','write',{path:'file.txt',content:'changed'},['business-write']);finish(events,a,jsonToolResult('write',{ok:true}))}];
  for(const mutate of mutations){const {events}=fixture();mutate(events);expect(()=>validateCheckpointEligibility(events,binding,'knowledge',normalize,input)).toThrow()}
  const {events}=fixture();expect(()=>validateCheckpointEligibility(events,binding,'other-knowledge',normalize,input)).toThrow();expect(()=>validateCheckpointEligibility(events,binding,'knowledge',normalize,{...input,baselineId:'not-found'})).toThrow();
});
it('暂存没有结束回执、终态失败/取消/停止、错误身份和后续放行均不签发checkpoint',()=>{
  for(const alter of [
    (events:ArtifactEvidenceEvent[])=>{events.splice(-2,1)},(events:ArtifactEvidenceEvent[])=>{events.at(-1)!.data.status='failed'},(events:ArtifactEvidenceEvent[])=>{events.at(-1)!.data.status='cancelled'},(events:ArtifactEvidenceEvent[])=>{events[0].data.memberBinding={...binding,agentSessionId:'foreign'}},(events:ArtifactEvidenceEvent[])=>{events[1].runId='foreign'},(events:ArtifactEvidenceEvent[])=>{events[1].seq++},(events:ArtifactEvidenceEvent[])=>{events.at(-2)!.data.isError=true},(events:ArtifactEvidenceEvent[])=>{events.at(-2)!.data.result=jsonToolResult('cbim_task_checkpoint',{forged:true})},
  ]){const {events}=fixture();checkpoint(events);alter(events);expect(()=>verify(events)).toThrow()}
  for(const type of ['run.stop_requested','tool.allowed']){const {events}=fixture();checkpoint(events);events.splice(-1,0,{...events[0],type,data:{id:'after',name:'read',input:{path:'file.txt'},effects:['read'],scope:{kind:'workspace',workspaceId:'workspace'}}});events.forEach((event,index)=>event.seq=index+1);expect(()=>verify(events)).toThrow()}
  const {events}=fixture();expect(verify(events)).toBeUndefined();
});
it('明确拒绝的后续调用无执行资格，不抹掉已正常结束的检查点',()=>{
  const {events}=fixture();checkpoint(events);const terminal=events.pop()!,call={id:'denied-later',name:'write',input:{path:'elsewhere',content:'none'}};append(events,'tool.proposed',call);append(events,'tool.denied',{...call,allow:false,receipt:toolReceipt({workspaceId:binding.workspaceId,taskId:binding.taskId,runId:binding.runId},call,{allow:false},'denied')});append(events,terminal.type,terminal.data);expect(verify(events)?.checkpoint.checkpointId).toBe('checkpoint-one');
});
it('孤立工具结束、未决审批与损坏否决回执不能被稳定文件字节掩盖',()=>{
  for(const type of ['tool.proposed','tool.finished','tool.started']){const {events}=fixture();append(events,type,{id:'orphan',name:'read',input:{path:'file.txt'}});expect(()=>validateCheckpointEligibility(events,binding,'knowledge',normalize,input)).toThrow()}
  const {events}=fixture();checkpoint(events);const terminal=events.pop()!;append(events,'tool.proposed',{id:'unknown',name:'write',input:{path:'other',content:'x'}});append(events,'tool.denied',{id:'unknown',name:'write',input:{path:'other',content:'x'},allow:false,receipt:{outcome:'denied'}});append(events,terminal.type,terminal.data);expect(()=>verify(events)).toThrow();
});
it('工具参数及返回严格；未知字段与伪造身份不能被包装成有效请求',async()=>{
  const {events}=fixture(),staged=checkpoint(events),stage=vi.fn(async()=>staged),tools=new MemberCheckpointTools({stage});
  for(const invalid of [{...input,path:'file.txt'},{...input,permission:'execute'},{...input,runId:'forged'},{...input,expectedTaskProgressVersion:0}]){expect(memberCheckpointInputSchema.safeParse(invalid).success).toBe(false);await expect(tools.call('cbim_task_checkpoint',invalid,'checkpoint')).rejects.toThrow()}
  expect(stage).not.toHaveBeenCalled();await expect(tools.call('cbim_task_checkpoint',input)).rejects.toThrow();expect(JSON.parse((await tools.call('cbim_task_checkpoint',input,'checkpoint')).content[0].text)).toMatchObject({state:'staged',checkpoint:staged});
  stage.mockResolvedValue({...staged,toolCallId:'another'});await expect(tools.call('cbim_task_checkpoint',input,'checkpoint')).rejects.toThrow();
});
it('共享待办门禁区分检查点/预约与已经消费后的历史，不能误放行scope等待',()=>{
  const {events}=fixture();checkpoint(events);const record=verify(events)!.checkpoint;
  expect(isMemberCheckpointPending({status:'checkpointed',checkpoints:[record],runIds:['first-run']})).toBe(true);expect(isMemberCheckpointPending({status:'queued',checkpoints:[record],runIds:['first-run']})).toBe(true);expect(isMemberCheckpointPending({status:'result_ready',checkpoints:[record],runIds:['first-run','second-run']})).toBe(false);expect(isMemberCheckpointPending({status:'cancelled',checkpoints:[record],runIds:['first-run']})).toBe(false);
});
