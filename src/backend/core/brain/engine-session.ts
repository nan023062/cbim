/**
 * 作用定位：主对话更换引擎时，沿已核实的日志链选择目标引擎历史并转交缺失的公开上下文。
 * 设计原因：不同引擎不能互读原生文件；保留同一逻辑会话身份，只恢复目标引擎自己保存的文件。
 * 职责边界：仅转交已落盘的对话与工具结果作为资料，不重放操作、不携带私有推理或扩大权限。
 */
import type {RunSummary} from './types';

export interface EngineSessionSelection {sessionFile?:string;nativeSessionId?:string;handoff?:string}
/** 超出边界或日志损坏明确拒绝，不能截断上下文后假称完整恢复。 */
export async function selectEngineSession(engine:string,previous:RunSummary,read:(runId:string)=>Promise<RunSummary>):Promise<EngineSessionSelection>{
  const records:RunSummary[]=[],seen=new Set<string>();let current:RunSummary|undefined=previous;
  while(current){
    if(seen.has(current.runId)||seen.size>=512)throw Error('引擎切换历史链异常或过长，请新建对话');seen.add(current.runId);
    if(current.task.taskId!==previous.task.taskId||current.task.workspaceId!==previous.task.workspaceId||current.task.root!==previous.task.root||current.logIntegrity?.partialTail||current.unresolvedTools.length)throw Error('历史记录无法可靠转交，请先核实原运行');
    if((current.events[0]?.data.engine??'pi')===engine){
      const bound=[...current.events].reverse().find(event=>event.type==='session.bound'&&event.data.sessionFile===current!.sessionFile);
      const nativeSessionId=typeof bound?.data.sessionId==='string'?bound.data.sessionId:undefined;
      return {sessionFile:current.sessionFile,...(nativeSessionId?{nativeSessionId}:{}),...(records.length?{handoff:history(records)}:{})};
    }
    records.push(current);
    const resume:unknown=current.events[0]?.data.resumeFrom;
    current=typeof resume==='string'?await read(resume):undefined;
  }
  return {handoff:history(records)};
}
function history(records:RunSummary[]):string{
  const value=records.reverse().map(run=>({runId:run.runId,engine:run.events[0]?.data.engine??'pi',status:run.status,input:run.events[0]?.data.message,source:run.source?.kind??'user',events:run.events.filter(event=>event.type==='message'||event.type==='tool.finished'||event.type==='tool.denied').map(event=>({type:event.type,data:event.data}))}));
  const encoded=JSON.stringify(value);if(Buffer.byteLength(encoded)>1024*1024)throw Error('切换引擎所需历史超过 1 MiB，请新建对话并提供必要摘要');
  return encoded;
}
