/**
 * 作用定位：计算完整产物清单身份，并从原 canonical 核实采集、授权和真实成功回执的对应关系。
 * 设计原因：范围、条目及引用须独立重算；暂存事件、模型返回的摘要或缺少终态的工具均不能单独形成完整证明。
 * 职责边界：不访问当前文件；历史真实性与当前集合复核分开，不借此签发业务验收或恢复。
 */
import {isDeepStrictEqual as equal} from 'node:util';
import {artifactScopeLimits,type ArtifactScopeBinding} from '../workspace/artifact-scope';
import {artifactSucceededCall,artifactEventChangesFiles,type ArtifactEvidenceEvent} from './artifact-evidence';
import {outputManifestInputSchema,outputManifestResultSchema,outputManifestStagedSchema,outputManifestToolName,type OutputManifestStaged,type OutputManifestRef,type OutputManifestRecord} from './output-manifest';
import {outputManifestReference} from './output-manifest-identity';
import {verifyArtifactTransitions,currentArtifactTransitions} from './artifact-transition-evidence';
export {outputManifestHash,outputManifestScopeHash,outputManifestReference} from './output-manifest-identity';

type Binding=OutputManifestStaged['binding'];
function valid(value:unknown,message:string):asserts value{if(!value)throw Error(message)}
/** 调用方核完整磁盘日志；本函数核运行绑定、递增顺序、冻结范围及逐次不可变采集链。 */
export function verifyOutputManifests(events:readonly ArtifactEvidenceEvent[],binding:Binding,knowledgeRevision:string,scopes:readonly ArtifactScopeBinding[]):{records:OutputManifestRecord[];refs:Array<OutputManifestRef&{invalidated:boolean}>;issues:Array<{code:string;message:string}>}{
  const records:OutputManifestRecord[]=[],issues:Array<{code:string;message:string}>=[];
  const issue=()=>{if(!issues.length)issues.push({code:'MANIFEST_EVIDENCE_INVALID',message:'完整清单的冻结范围、采集事件或成功回执无法核实'})};
  try{
    let previous=0;for(const event of events){valid(Number.isSafeInteger(event.seq)&&event.seq>previous&&event.workspaceId===binding.workspaceId&&event.taskId===binding.taskId&&event.runId===binding.runId&&event.data&&typeof event.data==='object','日志顺序或身份不一致');previous=event.seq}
    const head=events.find(event=>event.type==='run.started');valid(head&&equal(head.data.memberBinding,binding)&&!head.data.conversationBinding,'缺少原正式成员身份');
  }catch{issue();return {records,refs:[],issues}}
  const captures=events.filter(event=>event.type==='artifact.manifest_captured'),seen=new Set<string>(),calls=new Set<string>();
  if(captures.length>artifactScopeLimits.captures){issue();return {records,refs:[],issues}}
  for(const event of captures){
    try{
      const manifest=outputManifestStagedSchema.parse(event.data.manifest),ref=outputManifestReference(manifest);
      valid(scopes.length&&equal(manifest.scopes,scopes)&&equal(manifest.binding,binding)&&manifest.knowledgeRevision===knowledgeRevision,'清单不属于原冻结范围、知识或运行');
      valid(!seen.has(manifest.manifestId)&&!calls.has(manifest.captureToolCallId),'清单身份重复');seen.add(manifest.manifestId);calls.add(manifest.captureToolCallId);
      valid(captures.filter(item=>(item.data.manifest as {manifestId?:unknown})?.manifestId===manifest.manifestId).length===1&&captures.filter(item=>(item.data.manifest as {captureToolCallId?:unknown})?.captureToolCallId===manifest.captureToolCallId).length===1,'清单引用不唯一');
      const own=artifactSucceededCall(events,binding,manifest.captureToolCallId),input=outputManifestInputSchema.parse(own.allowed.data.input);
      valid(own.receipt.toolName===outputManifestToolName&&own.allowed.data.contractVersion===1&&own.receipt.scope.kind==='workspace'&&equal(own.receipt.effects,['maintenance'])&&input.expectedTaskProgressVersion===manifest.progressVersion,'采集授权、契约版本或进度不符');
      const content=(own.finished.data.result as {content?:Array<{type?:unknown;text?:unknown}>})?.content;
      valid(content?.length===1&&content[0].type==='text'&&typeof content[0].text==='string','缺少唯一 JSON 回包');
      const result=outputManifestResultSchema.parse(JSON.parse(content[0].text));valid(equal(result.binding,binding)&&equal(result.manifest,ref),'回包与原采集不一致');
      const before=events.filter(item=>item.seq<own.allowed.seq),lastEffect=before.reduce((seq,event)=>artifactEventChangesFiles(event)?event.seq:seq,0),progress=before.filter(item=>item.type==='task.updated').at(-1)?.data.progress as {version?:unknown}|undefined;
      valid(lastEffect===manifest.lastEffectSeq&&progress?.version===manifest.progressVersion&&own.allowed.seq<event.seq&&event.seq<own.finished.seq,'采集时进度、影响边界或顺序不符');
      valid(!events.some(item=>item.seq>own.allowed.seq&&item.seq<own.finished.seq&&['tool.allowed','task.updated','run.stop_requested','run.interrupted'].includes(item.type)),'采集期间存在其它操作、进度变化或停止');
      const operations=currentArtifactTransitions(before,verifyArtifactTransitions(before,binding,knowledgeRevision,scopes,records),manifest.snapshot);
      valid(equal(manifest.operations??[],operations),'清单操作证明不是原连续成功链或已被其它变化取代');
      records.push({manifest,capturedSeq:event.seq,finishedSeq:own.finished.seq});
    }catch{issue()}
  }
  if(records.length>artifactScopeLimits.captures){issue();return {records:[],refs:[],issues}}
  for(const event of events)if(event.type==='tool.finished'&&event.data.name===outputManifestToolName&&(event.data.receipt as {outcome?:unknown})?.outcome==='succeeded'&&!records.some(item=>item.manifest.captureToolCallId===event.data.id))issue();
  // 重规划获准后即保守失效；保存后坏回包不能因缺少 succeeded 回执而复活旧清单。
  const refs=records.map(record=>({...outputManifestReference(record.manifest),invalidated:events.some(event=>event.seq>record.capturedSeq&&(artifactEventChangesFiles(event)||event.type==='tool.allowed'&&event.data.name==='cbim_task_plan'))}));
  return {records,refs,issues};
}
