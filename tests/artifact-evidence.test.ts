import {expect,it,vi} from 'vitest';
import {hash} from '../src/backend/core/foundation/serialization';
import {jsonToolResult} from '../src/backend/core/tools/results';
import type {ToolReceipt} from '../src/backend/core/tools/types';
import {artifactSources,verifyArtifactBaselines,type ArtifactEvidenceEvent} from '../src/backend/core/tasks/artifact-evidence';
import {artifactCaptureInputSchema,artifactBaselineStagedSchema,artifactReportSchema,artifactReportInputSchema,artifactLimits,type ArtifactBaselineStaged} from '../src/backend/core/tasks/artifact-baseline';
import {ArtifactTools,artifactCaptureToolName} from '../src/backend/core/tasks/artifact-tools';
import {TaskProgressTools} from '../src/backend/core/tasks/progress-tools';

const binding={workspaceId:'workspace',teamId:'team',agentId:'agent',agentInstanceId:'instance',agentSessionId:'session',rootSessionId:'root',taskId:'task',runId:'run',leaseEpoch:1,planRevision:1},stamp='2026-11-07T00:00:00.000Z';
const normalize=(path:string)=>path.replace(/^\/workspace\//,'');
function append(events:ArtifactEvidenceEvent[],type:string,data:Record<string,unknown>){const value={type,seq:(events.at(-1)?.seq??0)+1,workspaceId:binding.workspaceId,taskId:binding.taskId,runId:binding.runId,data};events.push(value);return value}
function started(events:ArtifactEvidenceEvent[],id:string,name:string,input:Record<string,unknown>,effects:ToolReceipt['effects']=['read']){append(events,'tool.proposed',{id,name,input});return append(events,'tool.allowed',{id,name,input,effects,scope:{kind:'workspace',workspaceId:binding.workspaceId}})}
function finish(events:ArtifactEvidenceEvent[],allowed:ArtifactEvidenceEvent,result:unknown,outcome:ToolReceipt['outcome']='succeeded'){
  const data=allowed.data,r:ToolReceipt={version:1,toolCallId:String(data.id),toolName:String(data.name),workspaceId:binding.workspaceId,taskId:binding.taskId,runId:binding.runId,outcome,inputHash:hash(JSON.stringify(data.input)),resultHash:hash(JSON.stringify(result)),effects:data.effects as ToolReceipt['effects'],scope:data.scope as ToolReceipt['scope'],recordedAt:stamp};
  return append(events,'tool.finished',{id:data.id,name:data.name,result,receipt:r,isError:outcome==='failed'});
}
function capture(events:ArtifactEvidenceEvent[],suffix='1',sourceToolCallIds=['source']){
  const version=Number((events.filter(event=>event.type==='task.updated').at(-1)?.data.progress as {version:number}|undefined)?.version??1),input={expectedTaskProgressVersion:version,sourceToolCallIds},allowed=started(events,'capture-'+suffix,artifactCaptureToolName,input,['maintenance']),selected=artifactSources(events,binding,sourceToolCallIds);
  const baseline:ArtifactBaselineStaged={version:1,baselineId:'baseline-'+suffix,captureToolCallId:'capture-'+suffix,binding,knowledgeRevision:'knowledge',progressVersion:version,capturedAt:stamp,lastEffectSeq:selected.lastEffectSeq,sourceCalls:selected.sources.map(({path:_,...source})=>source),files:selected.sources.map(source=>({relativePath:normalize(source.path),byteLength:3,sha256:hash('abc'),sourceToolCallIds:[source.toolCallId]}))};
  append(events,'artifact.baseline_captured',{baseline});finish(events,allowed,jsonToolResult(artifactCaptureToolName,{state:'captured',baseline}));return baseline;
}
function setup(){const events:ArtifactEvidenceEvent[]=[];append(events,'run.started',{task:{workspaceId:binding.workspaceId,taskId:binding.taskId,agentId:binding.agentId},memberBinding:binding});append(events,'task.updated',{progress:{version:1}});const allowed=started(events,'source','read',{path:'/workspace/src/file.ts'});finish(events,allowed,jsonToolResult('read',{text:'abc'}));const baseline=capture(events);return {events,baseline}}
const verify=(events:ArtifactEvidenceEvent[])=>verifyArtifactBaselines(events,binding,'knowledge',normalize);
function resignCapture(events:ArtifactEvidenceEvent[]){const item=events.find(event=>event.type==='artifact.baseline_captured')!,baseline=item.data.baseline as ArtifactBaselineStaged,finished=events.find(event=>event.type==='tool.finished'&&event.data.id===baseline.captureToolCallId)!;finished.data.result=jsonToolResult(artifactCaptureToolName,{state:'captured',baseline});(finished.data.receipt as ToolReceipt).resultHash=hash(JSON.stringify(finished.data.result))}

it('共享校验绑定真实参数/回执/暂存事件，列表只派生引用而不改变原记录',()=>{
  const {events,baseline}=setup(),before=structuredClone(events),result=verify(events);expect(result.issues).toEqual([]);expect(result.impact).toBe('selected_files_only');expect(result.records).toEqual([{baseline,capturedSeq:8,finishedSeq:9}]);expect(result.refs).toEqual([{baselineId:'baseline-1',captureToolCallId:'capture-1',knowledgeRevision:'knowledge',progressVersion:1,capturedAt:stamp,capturedSeq:8,finishedSeq:9,fileCount:1,invalidated:false}]);expect(events).toEqual(before);
  const sources=artifactSources(events,binding,['source']);expect(sources.sources[0]).toMatchObject({path:'/workspace/src/file.ts',toolName:'read',allowedSeq:4,finishedSeq:5});expect(sources.lastEffectSeq).toBe(0);
});
it('不接受模型路径/哈希、空或重复来源，以及报告隐式选择其他身份',()=>{
  const valid={expectedTaskProgressVersion:1,sourceToolCallIds:['source']};expect(artifactCaptureInputSchema.safeParse(valid).success).toBe(true);
  for(const value of [{...valid,path:'private'},{...valid,sha256:hash('x')},{...valid,sourceToolCallIds:[]},{...valid,sourceToolCallIds:['source','source']},{...valid,expectedTaskProgressVersion:0},{...valid,sourceToolCallIds:Array.from({length:17},(_,i)=>'call-'+i)}])expect(artifactCaptureInputSchema.safeParse(value).success).toBe(false);
  expect(artifactReportInputSchema.safeParse({workspaceId:'workspace',rootSessionId:'root',taskId:'task',runId:'run'}).success).toBe(true);expect(artifactReportInputSchema.safeParse({workspaceId:'workspace',rootSessionId:'root',taskId:'task'}).success).toBe(false);
});
it('来源不能跨run或使用命令、失败回执、伪造结果与不支持的文件参数',()=>{
  const alters:Array<(events:ArtifactEvidenceEvent[])=>void>=[events=>{events[4].runId='other'},events=>{(events[4].data.receipt as ToolReceipt).outcome='failed'},events=>{events[4].data.result={text:'forged'}},events=>{events[2].data.input={path:'another'}},events=>{events[4].data.isError=true},events=>{events[0].data.memberBinding={...binding,agentSessionId:'other'}},events=>{events[4].data.receipt={...(events[4].data.receipt as ToolReceipt),scope:{kind:'unknown',workspaceId:'workspace'}}}];
  for(const alter of alters){const {events}=setup();alter(events);expect(()=>artifactSources(events,binding,['source'])).toThrow();expect(verify(events).records).toEqual([])}
  for(const [name,input,effects] of [['bash',{command:'cat file'},['command']],['read',{path:'file',glob:'*'},['read']],['write',{path:'file',text:'not-content'},['business-write']]] as const){const events:ArtifactEvidenceEvent[]=[];finish(events,started(events,'source',name,input,effects),{content:[]});expect(()=>artifactSources(events,binding,['source'])).toThrow()}
});
it('只有成功结束回执与同一暂存记录相符才有效，不能从返回正文补造基线',()=>{
  const alters:Array<(events:ArtifactEvidenceEvent[])=>void>=[events=>{events.pop()},events=>{events.splice(7,1)},events=>{(events[7].data.baseline as ArtifactBaselineStaged).knowledgeRevision='other';resignCapture(events)},events=>{(events[7].data.baseline as ArtifactBaselineStaged).files[0].relativePath='unrelated.ts';resignCapture(events)},events=>{(events[7].data.baseline as ArtifactBaselineStaged).sourceCalls[0].resultHash=hash('other');resignCapture(events)},events=>{events[1].data.progress={version:2}},events=>{(events[8].data.receipt as ToolReceipt).resultHash=hash('wrong')}];
  for(const alter of alters){const {events}=setup();alter(events);const result=verify(events);expect(result.records).toEqual([]);expect(result.issues.length).toBeGreaterThan(0);expect(result.impact).toBe('unknown')}
});
it('不预造序号，允许省略消息但拒逆序；采集中其它放行或停止不能签发稳定基线',()=>{
  const {events}=setup(),sparse=structuredClone(events).map(event=>({...event,seq:event.seq+10}));
  const staged=sparse[7].data.baseline as ArtifactBaselineStaged;staged.sourceCalls[0].allowedSeq+=10;staged.sourceCalls[0].finishedSeq+=10;resignCapture(sparse);expect(verify(sparse).records).toHaveLength(1);
  const reversed=structuredClone(events);[reversed[3],reversed[4]]=[reversed[4],reversed[3]];expect(verify(reversed).records).toEqual([]);
  for(const type of ['run.stop_requested','tool.allowed']){const f=setup();f.events[8].seq++;f.events.splice(8,0,{...f.events[0],seq:9,type,data:{id:'other',name:'write',input:{path:'src/file.ts',content:'x'},effects:['business-write']}});expect(verify(f.events).records).toEqual([])}
});
it('成功基线限制八份，重复ID和调用不可选择性保留一个作为真记录',()=>{
  const {events}=setup();for(let i=2;i<=8;i++)capture(events,String(i));expect(verify(events).records).toHaveLength(8);capture(events,'9');expect(verify(events)).toMatchObject({records:[],refs:[],impact:'unknown',issues:[{code:'ARTIFACT_LIMIT'}]});
  const duplicate=setup();capture(duplicate.events,'1');expect(verify(duplicate.events).records).toEqual([]);
});
it('后续写入或计划修订只标失效，命令与未覆盖写入保持未知且不改历史字节',()=>{
  for(const mode of ['write','command','plan','unknown'] as const){const {events,baseline}=setup(),before=structuredClone(baseline);
    if(mode==='unknown')append(events,'run.interrupted',{receipts:[]});
    else {const name=mode==='write'?'write':mode==='command'?'bash':'cbim_task_plan',input=mode==='write'?{path:'uncovered.ts',content:'new'}:mode==='command'?{command:'opaque'}:{expectedVersion:1},effect=mode==='write'?'business-write':mode==='command'?'command':'maintenance';finish(events,started(events,'later',name,input,[effect]),jsonToolResult(name,{ok:true}))}
    const result=verify(events);expect(result.records[0].baseline).toEqual(before);expect(result.refs[0].invalidated).toBe(mode!=='unknown');if(mode!=='plan')expect(result.impact).toBe('unknown');
  }
});
it('文件数/字节预算和相对业务路径严格有界，零字节文件仍可记录',()=>{
  const {baseline}=setup();expect(artifactBaselineStagedSchema.safeParse({...baseline,files:[{...baseline.files[0],byteLength:0}]}).success).toBe(true);
  for(const relativePath of ['../secret','/absolute','C:/private','x\\file','a/.cbim/file','x:stream','a//b'])expect(artifactBaselineStagedSchema.safeParse({...baseline,files:[{...baseline.files[0],relativePath}]}).success).toBe(false);
  expect(artifactBaselineStagedSchema.safeParse({...baseline,files:[{...baseline.files[0],byteLength:artifactLimits.fileBytes+1}]}).success).toBe(false);
  const large={...baseline,sourceCalls:Array.from({length:5},(_,i)=>({...baseline.sourceCalls[0],toolCallId:'source-'+i})),files:Array.from({length:5},(_,i)=>({...baseline.files[0],relativePath:'file-'+i,byteLength:artifactLimits.fileBytes,sourceToolCallIds:['source-'+i]}))};expect(artifactBaselineStagedSchema.safeParse(large).success).toBe(false);
});
it('采集同名文件不会消除失败或未结束写入的未知影响，中断回执数组也保留未知',()=>{
  for(const mode of ['failed','pending','interrupted'] as const){const {events}=setup();append(events,'task.updated',{progress:{version:2}});const allowed=started(events,'unsafe','write',{path:'src/file.ts',content:'uncertain'},['business-write']);
    if(mode==='failed')finish(events,allowed,jsonToolResult('write',{error:'partially changed'}),'failed');
    if(mode==='interrupted')append(events,'run.interrupted',{receipts:[{version:1,toolCallId:'unsafe',outcome:'unknown'}]});
    // 历史比较仍能看已捕获字节；报告不能因路径相同而说本轮影响已知。
    expect(verify(events).records).toHaveLength(1);expect(verify(events).impact).toBe('unknown');
  }
});
it('选中一份基线时不能借其它基线的文件覆盖未采集写入',()=>{
  const {events}=setup();append(events,'task.updated',{progress:{version:2}});finish(events,started(events,'write-other','write',{path:'src/other.ts',content:'abc'},['business-write']),jsonToolResult('write',{ok:true}));finish(events,started(events,'other-source','read',{path:'src/other.ts'}),jsonToolResult('read',{text:'abc'}));capture(events,'2',['other-source']);
  expect(verify(events).records).toHaveLength(2);expect(verify(events).impact).toBe('selected_files_only');
  expect(verifyArtifactBaselines(events,binding,'knowledge',normalize,'baseline-1').impact).toBe('unknown');
  expect(verifyArtifactBaselines(events,binding,'knowledge',normalize,'baseline-2').impact).toBe('selected_files_only');
});
it('无关调用的授权范围缺失或错绑也保留未知，不将损坏字段当作无副作用',()=>{
  for(const patch of [{effects:undefined},{scope:undefined},{effects:['not-a-known-effect']},{scope:{kind:'workspace',workspaceId:'another'}},{id:undefined},{name:undefined}]){
    const {events}=setup(),allowed=started(events,'unrelated','inspect_plugin',{query:'status'},['read']);finish(events,allowed,jsonToolResult('inspect_plugin',{ok:true}));Object.assign(allowed.data,patch);
    const result=verify(events);expect(result.records).toHaveLength(1);expect(result.impact).toBe('unknown');expect(result.issues).toContainEqual(expect.objectContaining({code:'ARTIFACT_AUTHORIZATION_INVALID'}));
  }
});
it('工具包装只传严格输入和真实callId；查询基线不变成完成证据且current返回副本',async()=>{
  const {events,baseline}=setup(),capturePort=vi.fn(async()=>baseline),tools=new ArtifactTools(binding,{capture:capturePort}),input={expectedTaskProgressVersion:1,sourceToolCallIds:['source']};
  await expect(tools.call(artifactCaptureToolName,{...input,path:'forged'},'capture-1')).rejects.toThrow();expect(capturePort).not.toHaveBeenCalled();await expect(tools.call(artifactCaptureToolName,input)).rejects.toThrow();
  const result=await tools.call(artifactCaptureToolName,input,'capture-1');expect(JSON.parse(result.content[0].text)).toMatchObject({state:'captured',baseline});expect(capturePort).toHaveBeenCalledWith(input,'capture-1');
  const refs=verify(events).refs,progress=new TaskProgressTools(undefined,async()=>{}, {identity:{workspaceId:binding.workspaceId,taskId:binding.taskId,runId:binding.runId},artifacts:()=>refs});await progress.call('cbim_task_plan',{expectedVersion:0,goal:'目标',acceptance:['验收'],reason:'计划',steps:[{id:'s',title:'做事',owner:'成员'}]});
  const current=progress.current()!;current.goal='改写';expect(progress.current()!.goal).toBe('目标');progress.record(events[8].data.receipt as ToolReceipt,progress.generation);
  const inspect=await progress.call('cbim_task_inspect',{}),view=JSON.parse(inspect.content[0].text);expect(view.artifacts).toEqual(refs);expect(view.evidence).toEqual([]);expect(progress.current()!.version).toBe(1);
  const report={identity:{workspaceId:'workspace',rootSessionId:'root',taskId:'task',runId:'run'},checkedAt:stamp,basis:hash('basis'),consistency:'stable',log:{state:'verified',lastSeq:9},coverage:'selected_files_only',impact:'selected_files_only',baselines:refs,issues:[]};expect(artifactReportSchema.safeParse(report).success).toBe(true);
});
