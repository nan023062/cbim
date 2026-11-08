/**
 * 作用定位：运行时和结算端共用成员检查点的纯证据门禁，核实文件来源全集、暂存/结束回执和正常终态。
 * 设计原因：选中文件哈希不能消除命令、动态目录集合或未知工具影响；首次只支持完整成功的单文件操作及本机任务维护工具。
 * 职责边界：本模块不读文件或原生会话，调用方仍须复核当前字节、知识、受管原生历史及磁盘完整性。
 */
import {fail} from '../foundation/errors';
import {hash,json} from '../foundation/serialization';
import {toolReceipt} from '../tools/receipts';
import type {ToolReceipt} from '../tools/types';
import {artifactSources,artifactSucceededCall,verifyArtifactBaselines,type ArtifactEvidenceEvent} from './artifact-evidence';
import {memberCheckpointInputSchema,memberCheckpointStagedSchema,memberCheckpointRecordSchema,memberCheckpointResultSchema,type MemberCheckpointInput,type MemberCheckpointStaged,type MemberCheckpointRecord} from './member-checkpoint';
const name='cbim_task_checkpoint',eventName='task.checkpoint_requested';
const maintenance=new Set(['cbim_task_plan','cbim_task_step','cbim_task_inspect','cbim_task_artifact_capture']);
type Binding=MemberCheckpointStaged['binding'];
function check(value:unknown,message:string):asserts value{if(!value)fail('MEMBER_CHECKPOINT_INVALID',message)}
function ordered(value:unknown):unknown{return Array.isArray(value)?value.map(ordered):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,ordered(v)])):value}
const equal=(a:unknown,b:unknown)=>JSON.stringify(ordered(a))===JSON.stringify(ordered(b));
/** 孤立结束或未决 proposed 不能被文件覆盖洗白；明确拒绝的调用须保留可信否决回执。 */
function closedTools(events:readonly ArtifactEvidenceEvent[],binding:Binding,pendingId?:string){
  const groups=new Map<string,ArtifactEvidenceEvent[]>();
  for(const event of events)if(['tool.proposed','tool.allowed','tool.denied','tool.finished','tool.started'].includes(event.type)){
    const id=event.data?.id;check(typeof id==='string'&&!!id,'工具记录缺少调用身份');groups.set(id,[...(groups.get(id)??[]),event]);
  }
  for(const [id,items] of groups){
    if(id===pendingId)continue;
    if(items.some(event=>event.type==='tool.allowed')){artifactSucceededCall(events,binding,id);continue}
    const proposed=items.filter(event=>event.type==='tool.proposed'),denied=items.filter(event=>event.type==='tool.denied'),finished=items.filter(event=>event.type==='tool.finished');
    check(proposed.length===1&&denied.length===1&&finished.length<=1,'本轮存在未结束、孤立或重复的工具调用');
    const p=proposed[0],d=denied[0];check(p.seq<d.seq&&typeof p.data.name==='string'&&d.data.name===p.data.name&&d.data.allow===false&&equal(p.data.input,d.data.input),'工具否决与原调用不一致');
    check(p.data.input&&typeof p.data.input==='object'&&!Array.isArray(p.data.input),'工具否决缺少结构化原参数');
    const call={id,name:p.data.name,input:p.data.input as Record<string,unknown>},decision={allow:false,effects:d.data.effects as ToolReceipt['effects']|undefined,scope:d.data.scope as ToolReceipt['scope']|undefined};
    for(const event of [d,...finished]){
      const r=event.data.receipt as ToolReceipt|undefined,expected=toolReceipt({workspaceId:binding.workspaceId,taskId:binding.taskId,runId:binding.runId},call,decision,'denied',event.type==='tool.finished'?event.data.result:undefined);
      check(r&&typeof r.recordedAt==='string'&&Number.isFinite(Date.parse(r.recordedAt))&&equal({...r,recordedAt:expected.recordedAt},expected),'工具否决缺少匹配的可信回执');
      if(event.type==='tool.finished')check(event.seq>d.seq&&event.data.name===p.data.name,'被拒绝工具的结束记录不一致');
    }
  }
}
/** 可在本次 checkpoint 已授权但未结束时调用；仅忽略明确传入的本次调用，不能忽略其他在途操作。 */
export function validateCheckpointEligibility(events:readonly ArtifactEvidenceEvent[],binding:Binding,knowledgeRevision:string,normalizePath:(path:string)=>string,raw:MemberCheckpointInput,activeCheckpointToolCallId?:string){
  const input=memberCheckpointInputSchema.parse(raw);
  closedTools(events,binding,activeCheckpointToolCallId);
  check(!events.some(event=>['run.stop_requested','run.interrupted','task.help_requested',eventName].includes(event.type)),'本轮已停止、中断、求助或记录检查点，不能继续建立检查点');
  const progress=events.filter(event=>event.type==='task.updated').at(-1)?.data.progress as {version?:unknown;state?:unknown;delivery?:unknown}|undefined;
  check(progress?.version===input.expectedTaskProgressVersion&&progress.state==='executing'&&!progress.delivery,'检查点必须保留本轮未交付的当前任务计划');
  const verified=verifyArtifactBaselines(events,binding,knowledgeRevision,normalizePath,input.baselineId),baseline=verified.records.find(record=>record.baseline.baselineId===input.baselineId),ref=verified.refs.find(record=>record.baselineId===input.baselineId);
  check(baseline&&ref&&!ref.invalidated&&verified.impact==='selected_files_only'&&!verified.issues.length,'所选文件基线不完整、已失效或含未知影响');
  check(baseline.baseline.progressVersion===input.expectedTaskProgressVersion,'任务进度已离开文件采集版本，请重新采集');
  const paths=new Set<string>(),ids=new Set<string>();
  for(const event of events){
    if(event.type!=='tool.allowed')continue;
    const id=event.data.id;check(typeof id==='string'&&!ids.has(id),'工具放行身份缺失或重复');ids.add(id);
    if(id===activeCheckpointToolCallId){check(event.data.name===name&&equal(memberCheckpointInputSchema.parse(event.data.input),input),'当前检查点调用参数与授权不一致');continue}
    const call=artifactSucceededCall(events,binding,id),tool=call.receipt.toolName;
    // 仓库正文即使字面看似文件或维护回执，也不能纳入同实例续执行的本地文件闭包。
    check(call.receipt.scope.kind!=='repository'&&!tool.startsWith('cbim_repository_'),'外部仓库读取不属于可恢复成员的文件检查点来源');
    if(['read','write','edit'].includes(tool)){
      const source=artifactSources(events,binding,[id]).sources[0];paths.add(normalizePath(source.path));
      check(call.receipt.effects.every(effect=>effect===(tool==='read'?'read':'business-write')),'文件来源包含未支持的额外副作用');
    }else check(maintenance.has(tool)&&call.receipt.scope.kind==='workspace'&&call.receipt.effects.length===1&&call.receipt.effects[0]==='maintenance','本轮含命令、目录扫描、外部来源或非白名单工具，不能安全续执行');
  }
  const files=new Set(baseline.baseline.files.map(file=>normalizePath(file.relativePath)));
  check(paths.size===files.size&&[...paths].every(path=>files.has(path)),'文件基线必须覆盖本轮全部 read/write/edit 路径，不能只选输出文件');
  const lastEffectSeq=artifactSources(events,binding,baseline.baseline.sourceCalls.map(source=>source.toolCallId)).lastEffectSeq;
  check(lastEffectSeq===baseline.baseline.lastEffectSeq,'文件采集后出现了新的副作用');
  return {baseline,progressVersion:input.expectedTaskProgressVersion,lastEffectSeq};
}
/** 只读取完整 canonical 事件；没有请求时不产生检查点，有损坏请求时拒绝而非当普通交付。 */
export function verifyMemberCheckpoint(events:readonly ArtifactEvidenceEvent[],binding:Binding,knowledgeRevision:string,normalizePath:(path:string)=>string):{checkpoint:MemberCheckpointRecord;logHash:string}|undefined{
  const requests=events.filter(event=>event.type===eventName);if(!requests.length)return;
  check(requests.length===1,'同一成员运行只允许一次检查点请求');
  check(events.length>0&&events[0].type==='run.started'&&events.filter(event=>event.type==='run.started').length===1&&events.filter(event=>event.type==='run.settled').length===1&&events.every((event,index)=>event.seq===index+1&&event.workspaceId===binding.workspaceId&&event.taskId===binding.taskId&&event.runId===binding.runId),'检查点必须使用本轮完整连续日志');
  const terminal=events.at(-1)!;check(terminal.type==='run.settled'&&terminal.data.status==='completed'&&!events.some(event=>['run.stop_requested','run.interrupted','task.help_requested'].includes(event.type)),'只有无停止和异常的正常关闭可交接检查点');
  closedTools(events,binding);
  const requested=requests[0],staged=memberCheckpointStagedSchema.parse(requested.data.checkpoint);
  check(equal(staged.binding,binding)&&staged.knowledgeRevision===knowledgeRevision,'检查点固定身份或知识版本不一致');
  const call=artifactSucceededCall(events,binding,staged.toolCallId),input=memberCheckpointInputSchema.parse(call.allowed.data.input);
  check(call.receipt.toolName===name&&equal(input,staged.input)&&call.receipt.effects.length===1&&call.receipt.effects[0]==='maintenance'&&call.receipt.scope.kind==='workspace','检查点成功回执与暂存请求不一致');
  const content=(call.finished.data.result as {content?:Array<{type?:unknown;text?:unknown}>})?.content;
  check(content?.length===1&&content[0].type==='text'&&typeof content[0].text==='string','检查点缺少结构化结束正文');
  const result=memberCheckpointResultSchema.parse(JSON.parse(content[0].text));check(equal(result.checkpoint,staged),'检查点正文与已保存事件不一致');
  check(call.allowed.seq<requested.seq&&requested.seq<call.finished.seq&&call.finished.seq<terminal.seq,'检查点请求与结束顺序无效');
  check(!events.some(event=>event.seq>call.allowed.seq&&event.type==='tool.allowed'),'检查点授权后不能再放行工具');
  const proof=validateCheckpointEligibility(events.filter(event=>event.seq<requested.seq),binding,knowledgeRevision,normalizePath,staged.input,staged.toolCallId);
  check(proof.lastEffectSeq===staged.lastEffectSeq,'检查点最后副作用边界不一致');
  return {checkpoint:memberCheckpointRecordSchema.parse({...staged,requestedSeq:requested.seq,finishedSeq:call.finished.seq,terminalSeq:terminal.seq}),logHash:hash(json(events))};
}
