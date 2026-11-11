/**
 * 作用定位：引擎工具回包的统一结果与下一步说明；独立于具体业务账本。
 * 设计原因：异常不能证明未执行，所有失败默认禁止自动重放；仅可信适配器可提供原命令的只读核实入口。
 */
import {Fault} from '../foundation/errors';
import type {ToolResult} from './results';
import {validateToolResult} from './results';

export interface ToolReconciliation {tool:string;args:Record<string,unknown>}
export interface ToolOutcome {
  status:'returned'|'rejected'|'unknown';retryable:false;terminal:true;
  reconcileTool:string|null;reconcileArgs:Record<string,unknown>|null;nextStep:string;
}
/** 保留原错误类型/码；只附加可信恢复地址，不改变原操作结果。 */
export function withToolReconciliation<T extends Error>(error:T,reconciliation:ToolReconciliation):T {
  return Object.assign(error,{reconciliation:structuredClone(reconciliation)});
}
export function toolOutcome(status:ToolOutcome['status'],reconciliation?:ToolReconciliation):ToolOutcome {
  return {status,retryable:false,terminal:true,reconcileTool:reconciliation?.tool??null,reconcileArgs:reconciliation?.args??null,
    nextStep:status==='returned'?'本次调用已返回；不重复执行，业务完成仍须独立验收。':status==='rejected'?'本次调用被拒绝；核实权限或修正参数，不以相同请求重试。':reconciliation?'只读查询原回执，未知/查无记录不证明未执行；不要换 ID 重做。':'核实原运行日志和实际文件/外部副作用；本工具没有可用的只读领域回执，不自动重试。'};
}
/** 错误正文保留可诊断消息；失败结构同时进入模型文本与宿主 details。 */
export function toolFailureResult(error:unknown,rejected=false):ToolResult {
  const candidate=error as {reconciliation?:ToolReconciliation};
  const reconciliation=candidate?.reconciliation;
  const code=error instanceof Fault?error.code:'TOOL_ERROR';
  const outcome=toolOutcome(rejected||code==='FORBIDDEN'?'rejected':'unknown',reconciliation);
  return {isError:true,content:[{type:'text',text:JSON.stringify({...outcome,code,message:error instanceof Error?error.message:String(error)})}],details:{outcome}};
}
/** 原领域文本不改写，避免破坏历史 Schema 与证据哈希；状态元数据是调用结果，不能当业务回执。 */
export function toolReturnedResult(result:ToolResult):ToolResult {
  const details=result.details&&typeof result.details==='object'&&!Array.isArray(result.details)?result.details as Record<string,unknown>:{original:result.details};
  if(result.isError){
    if(details.outcome)return result;
    return toolFailureResult(result.content.filter(block=>block.type==='text').map(block=>block.text).join('\n'));
  }
  let status:ToolOutcome['status']='returned';
  if(result.content.length===1&&result.content[0].type==='text'){
    try{const value=JSON.parse(result.content[0].text);if(value?.status==='unknown'||value?.status==='absent')status='unknown'}catch{/* 非 JSON 的正常工具文本保持原协议。 */}
  }
  return {...result,details:{...details,outcome:toolOutcome(status)}};
}

/** 传输适配层执行一次原调用并包装回包；目录层只保留注册与路由。 */
export async function runToolResult(name:string,execute:()=>Promise<unknown>):Promise<ToolResult>{
  try{return toolReturnedResult(validateToolResult(name,await execute()) as ToolResult)}
  catch(error){return toolFailureResult(error)}
}
