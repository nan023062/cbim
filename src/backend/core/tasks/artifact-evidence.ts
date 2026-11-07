/**
 * 作用定位：从本轮已提交事件核实文件采集来源与不可变基线，供运行时和只读报告共用。
 * 设计原因：工具成功、采集暂存事件及文件字节不能互相代替；参数与结果哈希、调用顺序、固定身份全部匹配后才发布引用，避免两套较宽松证据规则。
 * 职责边界：不读取文件、不授权恢复；事件可省略无关消息，但顺序必须递增，完整日志连续性和磁盘完整性由 canonical 读取方核实。
 */
import {z} from 'zod';
import {fail} from '../foundation/errors';
import {hash} from '../foundation/serialization';
import {toolScopeSchema} from '../tools/scope-schema';
import {artifactCaptureInputSchema,artifactBaselineStagedSchema,artifactBaselineRecordSchema,artifactCaptureResultSchema,artifactLimits,type ArtifactBaselineStaged,type ArtifactBaselineRecord,type ArtifactBaselineRef,type ArtifactSourceCall} from './artifact-baseline';

/** 只依赖事件的最小结构，不反向导入 brain/types；消息正文无需留在运行时采集缓存。 */
export interface ArtifactEvidenceEvent {type:string;seq:number;workspaceId:string;taskId:string;runId:string;data:Record<string,unknown>}
type Binding=ArtifactBaselineStaged['binding'];
type Issue={code:string;message:string};
const effects=z.array(z.enum(['read','preview','maintenance','business-write','knowledge-write','command']));
const authorization=z.object({id:z.string().min(1).max(128),name:z.string().min(1).max(512),effects,scope:toolScopeSchema}).passthrough();
const receipt=z.object({version:z.literal(1),toolCallId:z.string().min(1).max(128),toolName:z.string().min(1).max(512),workspaceId:z.string(),taskId:z.string(),runId:z.string(),outcome:z.enum(['succeeded','failed','denied','unknown']),inputHash:z.string().regex(/^[a-f0-9]{64}$/),resultHash:z.string().regex(/^[a-f0-9]{64}$/).optional(),effects,scope:toolScopeSchema,recordedAt:z.string().datetime()}).strict();
const nativeInput={read:z.object({path:z.string().min(1).max(32768),offset:z.number().int().positive().optional(),limit:z.number().int().positive().optional()}).strict(),write:z.object({path:z.string().min(1).max(32768),content:z.string()}).strict(),edit:z.object({path:z.string().min(1).max(32768),oldText:z.string(),newText:z.string()}).strict()};
const captureName='cbim_task_artifact_capture';
const altered=(event:ArtifactEvidenceEvent)=>event.type==='tool.allowed'&&(Array.isArray(event.data.effects)&&event.data.effects.some(effect=>['business-write','knowledge-write','command'].includes(String(effect)))||['write','edit','bash'].includes(String(event.data.name)));
function ordered(value:unknown):unknown{return Array.isArray(value)?value.map(ordered):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,ordered(v)])):value}
const equal=(a:unknown,b:unknown)=>JSON.stringify(ordered(a))===JSON.stringify(ordered(b));
function valid(value:unknown,message:string):asserts value{if(!value)fail('ARTIFACT_EVIDENCE_INVALID',message)}
function bound(events:readonly ArtifactEvidenceEvent[],binding:Binding){let previous=0;for(const event of events){valid(Number.isSafeInteger(event.seq)&&event.seq>previous&&event.workspaceId===binding.workspaceId&&event.taskId===binding.taskId&&event.runId===binding.runId&&event.data&&typeof event.data==='object'&&!Array.isArray(event.data),'采集事件顺序或运行身份不一致');previous=event.seq;if(event.type==='run.started'){const task=event.data.task as {workspaceId?:unknown;taskId?:unknown;agentId?:unknown;mode?:unknown}|undefined;valid(equal(event.data.memberBinding,binding)&&!event.data.conversationBinding&&task?.workspaceId===binding.workspaceId&&task.taskId===binding.taskId&&task.agentId===binding.agentId&&task.mode!=='chat','采集日志头不属于本次成员运行')}}}

/** 采集与 Workflow 共用唯一 proposed→allowed→finished 核验，只需工作区/任务/运行身份；Pi 的 started 不作为授权前提。 */
export function artifactSucceededCall(events:readonly ArtifactEvidenceEvent[],binding:Pick<Binding,'workspaceId'|'taskId'|'runId'>,id:string){
  const calls=events.filter(event=>['tool.proposed','tool.allowed','tool.denied','tool.finished'].includes(event.type)&&event.data.id===id),proposed=calls.filter(event=>event.type==='tool.proposed'),allowed=calls.filter(event=>event.type==='tool.allowed'),finished=calls.filter(event=>event.type==='tool.finished');
  valid(proposed.length===1&&allowed.length===1&&finished.length===1&&!calls.some(event=>event.type==='tool.denied'),'来源工具没有唯一完整的成功授权链');
  const p=proposed[0],a=allowed[0],f=finished[0],parsed=receipt.safeParse(f.data.receipt);valid(parsed.success,'来源工具回执结构无效');const r=parsed.data;
  valid(p.seq<a.seq&&a.seq<f.seq&&typeof p.data.name==='string'&&p.data.name===a.data.name&&a.data.name===f.data.name&&f.data.isError!==true&&!(f.data.result as {isError?:unknown}|undefined)?.isError,'来源调用顺序、工具名称或成功状态不一致');
  valid(p.data.input&&typeof p.data.input==='object'&&!Array.isArray(p.data.input)&&equal(p.data.input,a.data.input)&&r.inputHash===hash(JSON.stringify(p.data.input))&&r.inputHash===hash(JSON.stringify(a.data.input)),'来源参数与真实授权回执不一致');
  valid(r.toolCallId===id&&r.toolName===p.data.name&&r.workspaceId===binding.workspaceId&&r.taskId===binding.taskId&&r.runId===binding.runId&&r.outcome==='succeeded'&&r.scope.workspaceId===binding.workspaceId&&r.resultHash&&f.data.result!==undefined&&r.resultHash===hash(JSON.stringify(f.data.result))&&equal(r.effects,a.data.effects)&&equal(r.scope,a.data.scope),'来源结果与本轮真实回执不一致');
  return {proposed:p,allowed:a,finished:f,receipt:r};
}

/** 严格提取 read/write/edit 原始单文件参数，返回的 path 仍须经平台受限采集端口处理。 */
export function artifactSources(events:readonly ArtifactEvidenceEvent[],binding:Binding,ids:readonly string[]):{sources:Array<ArtifactSourceCall&{path:string}>;lastEffectSeq:number}{
  bound(events,binding);valid(ids.length>0&&ids.length<=artifactLimits.sources&&new Set(ids).size===ids.length,'采集来源数量无效或重复');
  const sources=ids.map<ArtifactSourceCall&{path:string}>(id=>{
    const item=artifactSucceededCall(events,binding,id),name=item.receipt.toolName;valid(name==='read'||name==='write'||name==='edit','仅支持真实 read/write/edit 单文件来源，不解析命令或目录');
    const input=nativeInput[name].safeParse(item.allowed.data.input);valid(input.success,'文件工具参数不符合已支持的单文件协议');
    valid(item.receipt.scope.kind==='workspace'&&item.receipt.effects.includes(name==='read'?'read':'business-write'),'来源授权不属于工作区文件操作');
    return {toolCallId:id,toolName:name,allowedSeq:item.allowed.seq,finishedSeq:item.finished.seq,inputHash:item.receipt.inputHash,resultHash:item.receipt.resultHash!,path:input.data.path};
  });
  return {sources,lastEffectSeq:events.reduce((value,event)=>altered(event)?event.seq:value,0)};
}

/** 所有路径比较只作词法规范化，不能读取当前文件；删除文件不应抹掉历史采集事实。 */
export function verifyArtifactBaselines(events:readonly ArtifactEvidenceEvent[],binding:Binding,knowledgeRevision:string,normalizePath:(path:string)=>string,selectedBaselineId?:string):{records:ArtifactBaselineRecord[];refs:ArtifactBaselineRef[];issues:Issue[];impact:'selected_files_only'|'unknown'}{
  const records:ArtifactBaselineRecord[]=[],issues:Issue[]=[];let impact:'selected_files_only'|'unknown'='selected_files_only';
  const add=(code:string,message:string)=>{if(issues.length<32&&!issues.some(issue=>issue.code===code&&issue.message===message))issues.push({code,message})};
  try{bound(events,binding)}catch{ return {records:[],refs:[],issues:[{code:'ARTIFACT_LOG_INVALID',message:'运行记录身份或顺序不完整，无法核实文件基线'}],impact:'unknown'} }
  const captures=events.filter(event=>event.type==='artifact.baseline_captured'),ids=new Map<string,number>(),calls=new Map<string,number>();
  for(const event of captures){const value=event.data.baseline as Partial<ArtifactBaselineStaged>|undefined;if(value?.baselineId)ids.set(value.baselineId,(ids.get(value.baselineId)??0)+1);if(value?.captureToolCallId)calls.set(value.captureToolCallId,(calls.get(value.captureToolCallId)??0)+1)}
  for(const event of captures){
    try{
      const parsed=artifactBaselineStagedSchema.safeParse(event.data.baseline);valid(parsed.success,'采集事件字段无效');const baseline=parsed.data;
      valid(equal(baseline.binding,binding)&&baseline.knowledgeRevision===knowledgeRevision&&ids.get(baseline.baselineId)===1&&calls.get(baseline.captureToolCallId)===1,'基线身份、知识或唯一标识不一致');
      const own=artifactSucceededCall(events,binding,baseline.captureToolCallId),input=artifactCaptureInputSchema.safeParse(own.allowed.data.input);
      valid(own.receipt.toolName===captureName&&own.receipt.scope.kind==='workspace'&&own.receipt.effects.includes('maintenance')&&input.success&&input.data.expectedTaskProgressVersion===baseline.progressVersion,'采集调用范围与进度版本不一致');
      const content=(own.finished.data.result as {content?:unknown[]}|undefined)?.content;valid(Array.isArray(content)&&content.length===1,'采集工具正文不完整');
      const block=content[0] as {type?:unknown;text?:unknown};valid(block?.type==='text'&&typeof block.text==='string','采集工具没有结构化文本结果');
      const body=artifactCaptureResultSchema.safeParse(JSON.parse(block.text));valid(body.success&&equal(body.data.baseline,baseline),'采集暂存事件与真实成功回执不一致');
      const before=events.filter(value=>value.seq<event.seq),selected=artifactSources(before,binding,input.data.sourceToolCallIds),sourceCalls=selected.sources.map(({path:_,...source})=>source);
      valid(equal(sourceCalls,baseline.sourceCalls)&&baseline.lastEffectSeq===selected.lastEffectSeq&&own.allowed.seq<event.seq&&event.seq<own.finished.seq&&sourceCalls.every(source=>source.finishedSeq<own.allowed.seq),'采集来源、操作界限或事件顺序不一致');
      const progress=before.filter(value=>value.type==='task.updated').at(-1)?.data.progress as {version?:unknown}|undefined;valid(progress?.version===baseline.progressVersion,'采集时进度版本没有对应的真实记录');
      valid(!events.some(value=>value.seq>own.allowed.seq&&value.seq<own.finished.seq&&(value.type==='run.stop_requested'||value.type==='run.interrupted'||value.type==='tool.allowed')),'采集期间出现停止或其它工具放行，不能核实稳定字节');
      for(const file of baseline.files)for(const id of file.sourceToolCallIds){const source=selected.sources.find(value=>value.toolCallId===id);valid(source&&normalizePath(source.path)===normalizePath(file.relativePath),'采集文件与真实工具参数的路径关联不一致')}
      const record=artifactBaselineRecordSchema.parse({baseline,capturedSeq:event.seq,finishedSeq:own.finished.seq});records.push(record);
    }catch{impact='unknown';add('ARTIFACT_BASELINE_INVALID','存在未完成、损坏或来源不匹配的采集记录，不能作为已核实基线')}
  }
  if(records.length>artifactLimits.baselines){return {records:[],refs:[],issues:[{code:'ARTIFACT_LIMIT',message:'本轮成功基线超过受支持上限，不能核实完整清单'}],impact:'unknown'}}
  // 采集成功但没有相应暂存事件也属于损坏，不从工具正文补造记录。
  for(const event of events)if(event.type==='tool.finished'&&event.data.name===captureName&&(event.data.receipt as {outcome?:unknown}|undefined)?.outcome==='succeeded'&&!records.some(record=>record.baseline.captureToolCallId===event.data.id)){impact='unknown';add('ARTIFACT_BASELINE_INVALID','采集成功回执缺少匹配的基线事件')}
  const refs=records.map(({baseline,capturedSeq,finishedSeq})=>({baselineId:baseline.baselineId,captureToolCallId:baseline.captureToolCallId,knowledgeRevision:baseline.knowledgeRevision,progressVersion:baseline.progressVersion,capturedAt:baseline.capturedAt,capturedSeq,finishedSeq,fileCount:baseline.files.length,invalidated:events.some(event=>event.seq>capturedSeq&&(altered(event)||event.type==='tool.finished'&&event.data.name==='cbim_task_plan'&&(event.data.receipt as {outcome?:unknown}|undefined)?.outcome==='succeeded'))}));
  // 明确复核一份时不能借用另一份基线的文件来宣称已覆盖；列表仅描述已记录集合，始终不是工作区完整覆盖。
  const selected=selectedBaselineId?records.filter(record=>record.baseline.baselineId===selectedBaselineId):records;
  const covered=new Set(selected.flatMap(record=>record.baseline.files.map(file=>normalizePath(file.relativePath))));
  for(const event of events){
    const unknownReceipt=event.type==='run.interrupted'||event.type==='tool.finished'&&(event.data.receipt as {outcome?:unknown}|undefined)?.outcome==='unknown';
    if(unknownReceipt){impact='unknown';add('ARTIFACT_UNKNOWN_EFFECT','存在未知工具结果，所列文件不能代表完整影响范围')}
    if(event.type!=='tool.allowed')continue;
    // 缺失的授权范围不是“没有副作用”；即使它不属于所选来源，也不能让损坏日志替整轮洗白。
    const authorized=authorization.safeParse(event.data);
    if(!authorized.success||authorized.data.scope.workspaceId!==binding.workspaceId){impact='unknown';add('ARTIFACT_AUTHORIZATION_INVALID','存在范围或身份不可核实的工具授权，所列文件不能代表完整影响范围');continue}
    const values=authorized.data.effects,scope=authorized.data.scope;
    if(scope.kind==='repository'){impact='unknown';add('ARTIFACT_EXTERNAL_SOURCE','存在外部仓库资料，文件指纹不能证明该来源内容或工作区完整覆盖')}
    else if(values.includes('command')||scope.kind==='unknown'||event.data.name==='bash'){impact='unknown';add('ARTIFACT_COMMAND_SCOPE','命令或未知范围不能由文件指纹推断完整影响')}
    else if(values.includes('business-write')||['write','edit'].includes(String(event.data.name))){
      try{const name=event.data.name;valid(name==='write'||name==='edit','未知写入工具');artifactSucceededCall(events,binding,String(event.data.id));const parsed=nativeInput[name].parse(event.data.input);valid(covered.has(normalizePath(parsed.path)),'写入文件未被采集')}
      catch{impact='unknown';add('ARTIFACT_UNCOVERED_WRITE','存在未覆盖或不可解析的写入，基线只代表明确列出的文件')}
    }
  }
  return {records,refs,issues,impact};
}
