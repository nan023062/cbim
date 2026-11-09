import {expect,it,vi} from 'vitest';
import {MemberHelpTools} from '../src/backend/core/tasks/member-help-tools';
import {ArtifactTools,artifactCaptureToolName} from '../src/backend/core/tasks/artifact-tools';
import {MemberCheckpointTools,memberCheckpointToolName} from '../src/backend/core/tasks/member-checkpoint-tools';
import type {MemberHelpStaged} from '../src/backend/core/tasks/member-help';
import type {ArtifactBaselineStaged} from '../src/backend/core/tasks/artifact-baseline';
import type {MemberCheckpointStaged} from '../src/backend/core/tasks/member-checkpoint';

const binding={workspaceId:'workspace',teamId:'team',agentId:'executor',agentInstanceId:'instance',agentSessionId:'session',rootSessionId:'root',taskId:'task',runId:'run',leaseEpoch:1,planRevision:1};
const stamp='2026-11-07T00:00:00.000Z',digest='a'.repeat(64);
const helpInput={kind:'dependency' as const,reason:'缺少输入',question:'请主调度确认输入',attemptedToolCallIds:[] as string[]};
const captureInput={expectedTaskProgressVersion:1,sourceToolCallIds:['read-one']};
const checkpointInput={expectedTaskProgressVersion:1,baselineId:'baseline-one',reason:'保存当前工作位置'};
const baseline=():ArtifactBaselineStaged=>({version:1,baselineId:'baseline-one',captureToolCallId:'capture',binding:{...binding},knowledgeRevision:'knowledge',progressVersion:1,capturedAt:stamp,lastEffectSeq:0,sourceCalls:[{toolCallId:'read-one',toolName:'read',allowedSeq:1,finishedSeq:2,inputHash:digest,resultHash:digest}],files:[{relativePath:'file.txt',byteLength:4,sha256:digest,sourceToolCallIds:['read-one']}]});
const checkpoint=():MemberCheckpointStaged=>({version:1,checkpointId:'checkpoint-one',toolCallId:'checkpoint',binding:{...binding},input:structuredClone(checkpointInput),knowledgeRevision:'knowledge',requestedAt:stamp,lastEffectSeq:0});
const body=(value:{content:{text:string}[]})=>JSON.parse(value.content[0].text);

it('三个成员工具只公开实际输出和保存前取消语义，结束轮次工具不推荐本轮继续查询',async()=>{
  const help=new MemberHelpTools(binding,{save:async()=>{},assertReady:()=>{}}),capture=new ArtifactTools(binding,{capture:async()=>baseline()}),stop=new MemberCheckpointTools(binding,{stage:async()=>checkpoint()});
  for(const tools of [help,capture,stop]){
    const [definition]=await tools.list();expect(definition.version).toBe(1);expect(definition.effects).toEqual(['maintenance']);expect(definition.outputSchema).toHaveProperty('$schema');expect(definition.cancellation.mode).toBe('preflight_only');expect(definition.recovery.mode).toBe('inspect_before_retry');
    if(definition.name!=='cbim_task_artifact_capture')expect(definition.recovery.queryTool).toBeUndefined();
  }
});

it('求助保存后同一对象被改写也不能自比通过，原记录保留且门闩不解除',async()=>{
  for(const change of [(value:MemberHelpStaged)=>{value.input.reason='被端口改写'},(value:MemberHelpStaged)=>{value.helpId='different-id'},(value:MemberHelpStaged)=>{value.requestedAt='2026-11-08T00:00:00.000Z'},(value:MemberHelpStaged)=>{value.binding.agentSessionId='another'}]){
    const persisted:MemberHelpStaged[]=[],save=vi.fn(async(value:MemberHelpStaged)=>{persisted.push(structuredClone(value));change(value)}),tools=new MemberHelpTools(binding,{save,assertReady:()=>{}});
    expect(tools.guard('cbim_task_help','help',helpInput,[])).toBeUndefined();await expect(tools.call('cbim_task_help',helpInput,'help')).rejects.toMatchObject({code:'TOOL_OUTPUT_INVALID'});
    expect(persisted).toHaveLength(1);expect(persisted[0].input).toEqual(helpInput);expect(persisted[0].binding).toEqual(binding);tools.denied('help');expect(tools.guard('read','later',{},[])).toContain('结束本轮');await expect(tools.call('cbim_task_help',helpInput,'help')).rejects.toThrow('一次性');expect(save).toHaveBeenCalledTimes(1);
  }
  const save=vi.fn(async()=>{}),tools=new MemberHelpTools(binding,{save,assertReady:(_id,ids)=>{ids.push('not-requested')}});tools.guard('cbim_task_help','help',helpInput,[]);await expect(tools.call('cbim_task_help',helpInput,'help')).rejects.toMatchObject({code:'TOOL_OUTPUT_INVALID'});expect(save).toHaveBeenCalledTimes(1);
});

it('求助唯一 wire 不被第二次 toJSON 改写，也不把正文或错误值带入失败消息',async()=>{
  let snapshots=0;const tools=new MemberHelpTools(binding,{save:async value=>{const original=structuredClone(value);Object.defineProperty(value,'toJSON',{value:()=>{snapshots++;return snapshots===1?original:{private:'secret'}}})},assertReady:()=>{}});
  tools.guard('cbim_task_help','help',helpInput,[]);expect(body(await tools.call('cbim_task_help',helpInput,'help')).help.input).toEqual(helpInput);expect(snapshots).toBe(1);
  const invalid=new MemberHelpTools(binding,{save:async value=>{Object.defineProperty(value,'toJSON',{value:()=>({secret:'DO_NOT_DISCLOSE'})})},assertReady:()=>{}});invalid.guard('cbim_task_help','help',helpInput,[]);
  const error=await invalid.call('cbim_task_help',helpInput,'help').catch(value=>value);expect(error.code).toBe('TOOL_OUTPUT_INVALID');expect(error.message).not.toContain('DO_NOT_DISCLOSE');
});

it('文件采集严格核实完整成员绑定、真实调用、知识和原来源，不修复领域返回值',async()=>{
  const variants:unknown[]=[undefined,null,{...baseline(),extra:'not-public'},...Object.keys(binding).map(key=>({...baseline(),binding:{...binding,[key]:typeof binding[key as keyof typeof binding]==='number'?2:'foreign'}})),{...baseline(),captureToolCallId:'other'},{...baseline(),knowledgeRevision:'other'},{...baseline(),progressVersion:2},{...baseline(),sourceCalls:[{...baseline().sourceCalls[0],toolCallId:'other'}],files:[{...baseline().files[0],sourceToolCallIds:['other']}]}];
  for(const value of variants){const capture=vi.fn(async()=>value as ArtifactBaselineStaged),tools=new ArtifactTools(binding,{knowledgeRevision:'knowledge',capture});await expect(tools.call(artifactCaptureToolName,captureInput,'capture')).rejects.toMatchObject({code:'TOOL_OUTPUT_INVALID'});expect(capture).toHaveBeenCalledTimes(1)}
});

it('采集保存端口修改输入后返回对应坏结果，仍按调用前请求拒绝且只执行一次',async()=>{
  const captured:ArtifactBaselineStaged[]=[],capture=vi.fn(async(input:typeof captureInput)=>{const saved=baseline();captured.push(structuredClone(saved));input.expectedTaskProgressVersion=2;input.sourceToolCallIds[0]='foreign';return {...saved,progressVersion:2,sourceCalls:[{...saved.sourceCalls[0],toolCallId:'foreign'}],files:[{...saved.files[0],sourceToolCallIds:['foreign']}]}}),tools=new ArtifactTools(binding,{capture});
  await expect(tools.call(artifactCaptureToolName,captureInput,'capture')).rejects.toMatchObject({code:'TOOL_OUTPUT_INVALID'});expect(captured[0]).toEqual(baseline());expect(capture).toHaveBeenCalledTimes(1);expect(captureInput.sourceToolCallIds).toEqual(['read-one']);
});

it('检查点绑定与请求独立冻结，端口修改别名或返回错调用均报输出错误',async()=>{
  for(const change of [(value:MemberCheckpointStaged)=>{value.binding.leaseEpoch++},(value:MemberCheckpointStaged)=>{value.toolCallId='other'},(value:MemberCheckpointStaged)=>{value.knowledgeRevision='other'},(value:MemberCheckpointStaged)=>{value.input.reason='changed'}]){
    const stage=vi.fn(async()=>{const result=checkpoint();change(result);return result}),tools=new MemberCheckpointTools(binding,{knowledgeRevision:'knowledge',stage});await expect(tools.call(memberCheckpointToolName,checkpointInput,'checkpoint')).rejects.toMatchObject({code:'TOOL_OUTPUT_INVALID'});expect(stage).toHaveBeenCalledTimes(1);
  }
  const saved:MemberCheckpointStaged[]=[],stage=vi.fn(async(input:typeof checkpointInput)=>{saved.push(checkpoint());input.reason='mutated';return {...checkpoint(),input}}),tools=new MemberCheckpointTools(binding,{stage});await expect(tools.call(memberCheckpointToolName,checkpointInput,'checkpoint')).rejects.toMatchObject({code:'TOOL_OUTPUT_INVALID'});expect(saved[0].input).toEqual(checkpointInput);expect(stage).toHaveBeenCalledTimes(1);
});

it('采集和检查点先保留真实 wire，单次 toJSON 与构造后的外部绑定变动不能改变期望身份',async()=>{
  for(const kind of ['capture','checkpoint'] as const){
    const originalBinding={...binding};let count=0;const value=kind==='capture'?baseline():checkpoint();Object.defineProperty(value,'toJSON',{value:()=>{count++;return count===1?(kind==='capture'?baseline():checkpoint()):null}});
    const port={knowledgeRevision:'knowledge',capture:vi.fn(async()=>value as ArtifactBaselineStaged),stage:vi.fn(async()=>value as MemberCheckpointStaged)};
    const tools=kind==='capture'?new ArtifactTools(originalBinding,port):new MemberCheckpointTools(originalBinding,port);originalBinding.agentInstanceId='changed-after-construction';port.knowledgeRevision='changed-after-construction';
    const result=await tools.call(kind==='capture'?artifactCaptureToolName:memberCheckpointToolName,kind==='capture'?captureInput:checkpointInput,kind==='capture'?'capture':'checkpoint');expect(body(result)).toHaveProperty('state');expect(count).toBe(1);
  }
});

it('模型的额外身份字段在调用端口前拒绝，端口原异常不被伪装成输出失败或重试',async()=>{
  const error=Error('stage-save-failed'),capture=vi.fn(async()=>{throw error}),stage=vi.fn(async()=>{throw error}),tools=new ArtifactTools(binding,{capture}),stop=new MemberCheckpointTools(binding,{stage});
  await expect(tools.call(artifactCaptureToolName,{...captureInput,runId:'forged'},'capture')).rejects.toThrow();await expect(stop.call(memberCheckpointToolName,{...checkpointInput,runId:'forged'},'checkpoint')).rejects.toThrow();expect(capture).not.toHaveBeenCalled();expect(stage).not.toHaveBeenCalled();
  await expect(tools.call(artifactCaptureToolName,captureInput,'capture')).rejects.toBe(error);await expect(stop.call(memberCheckpointToolName,checkpointInput,'checkpoint')).rejects.toBe(error);expect(capture).toHaveBeenCalledTimes(1);expect(stage).toHaveBeenCalledTimes(1);
});
