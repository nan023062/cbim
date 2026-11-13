/**
 * 目录归属：logic/execution/rules/execution；运行协议与计量。
 * 作用定位：主对话续聊或更换引擎时选择可靠原生历史，对无交互启动失败只转交已记录的公开输入。
 * 设计原因：不同引擎不能互读原生文件；未产生回复或工具调用的启动失败可转交公开输入，但不能把缺失文件伪装成原生恢复。
 * 职责边界：仅转交已落盘的对话与工具结果作为资料，不重放操作、不携带私有推理或扩大权限。
 */
import type {RunSummary} from './types';
import {safeId} from '../ports/identity';

export interface EngineSessionSelection {sessionFile?:string;nativeSessionId?:string;handoff?:string}
/** 仅允许完整封存且没有模型输出/工具调用的主聊天启动失败；不是未知执行结果的恢复许可。 */
function failedBeforeInteraction(run:RunSummary):boolean {
  const terminal=run.events.at(-1);
  return run.task.mode==='chat'&&run.task.agentId==='cbim:main'&&!run.memberBinding&&!run.source&&!run.events[0]?.data.freshMain
    &&run.logIntegrity?.partialTail===false&&['failed','interrupted','cancelled'].includes(run.status)
    &&(terminal?.type==='run.interrupted'||terminal?.type==='run.settled')
    &&!run.events.some(event=>['tool.proposed','tool.allowed','tool.finished','tool.denied','message','message.delta'].includes(event.type));
}
/** 超出边界或日志损坏明确拒绝，不能截断上下文后假称完整恢复。 */
export async function selectEngineSession(engine:string,previous:RunSummary,read:(runId:string)=>Promise<RunSummary>):Promise<EngineSessionSelection>{
  const records:RunSummary[]=[],seen=new Set<string>();let current:RunSummary|undefined=previous;
  while(current){
    if(seen.has(current.runId)||seen.size>=512)throw Error('引擎切换历史链异常或过长，请新建对话');seen.add(current.runId);
    if(current.task.taskId!==previous.task.taskId||current.task.workspaceId!==previous.task.workspaceId||current.task.root!==previous.task.root||current.logIntegrity?.partialTail||current.unresolvedTools.length)throw Error('历史记录无法可靠转交，请先核实原运行');
    const bound=[...current.events].reverse().find(event=>event.type==='session.bound');
    if(bound?.data.sessionId!==undefined&&(typeof bound.data.sessionId!=='string'||current.sessionFile&&bound.data.sessionFile!==current.sessionFile))throw Error('原生会话身份记录与恢复文件不一致');
    const nativeSessionId=typeof bound?.data.sessionId==='string'?safeId(bound.data.sessionId):undefined;
    if(!current.sessionFile&&!failedBeforeInteraction(current))throw Error('缺少原生会话记录，不能伪装成恢复');
    if(current.sessionFile&&(current.events[0]?.data.engine??'pi')===engine){
      return {sessionFile:current.sessionFile,...(nativeSessionId?{nativeSessionId}:{}),...(records.length?{handoff:history(records)}:{})};
    }
    // 首次请求失败可能只有线程 ID，显式重发沿历史寻找可靠旧文件；没有则新建，并只转交输入资料。
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
