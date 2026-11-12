/**
 * 目录归属：backend/engines/codex；Codex 引擎适配。

 * 原生和内部失败均返回统一结果与核实建议；成功元数据不替代原领域正文或验收。
 * 作用定位：把 Codex dynamic tool 请求路由到 CBIM 知识/执行工具及已有宿主文件操作。
 * 能力边界：是否关闭原生工具由可信能力策略决定，不依赖具体业务工具名称。
 * 设计原因：原生内置工具关闭，每次调用均以 thread/turn/call 身份核对、先结算预算、再授权、保存结果后回包。
 */
import {toolFailureResult,toolReturnedResult} from '../../core/tools/outcome';
import type {EngineContext} from '../../core/execution/types';
import {nativeToolsDisabled} from '../../core/execution/engine-tools';
import type {EngineToolsPort,EngineToolSchema} from '../../core/execution/engine-tools';
import {nativeToolNames} from '../../core/tools/native-tools';
import {validateToolResult,type ToolResult} from '../../core/tools/results';

export interface CodexToolSpec {type:'function';name:string;description:string;inputSchema:Record<string,unknown>}
/** 一个 run 只持有自己的调用身份及取消信号；重复 callId 不执行第二次。 */
export async function codexTools(context:EngineContext,port:EngineToolsPort,native:EngineToolsPort,allowExecution:boolean,settle:()=>Promise<void>){
  const controller=new AbortController(),seen=new Set<string>(),active=new Set<Promise<unknown>>();
  const internal=await port.list(),nativeCatalog=nativeToolsDisabled(context)?[]:await native.list();
  const mapping=new Map<string,{name:string;port:EngineToolsPort;schema:EngineToolSchema}>();
  for(const schema of internal)mapping.set(schema.name,{name:schema.name,port,schema});
  for(const schema of nativeCatalog)mapping.set('cbim_native_'+schema.name,{name:schema.name,port:native,schema});
  const nativeAllowed=new Set(nativeToolNames(allowExecution,'codex'));
  const available=[...mapping].filter(([,entry])=>entry.port===port||nativeAllowed.has(entry.name));
  const spec=([name,entry]:[string,{schema:EngineToolSchema}]):CodexToolSpec=>({type:'function',name,description:entry.schema.description??name,inputSchema:entry.schema.inputSchema});
  const registered=[...mapping].map(spec),catalog=available.map(spec),allowed=new Set(catalog.map(tool=>tool.name));
  async function invoke(input:{callId:string;tool:string;arguments:unknown}){
    if(typeof input.callId!=='string'||!input.callId||seen.has(input.callId))throw Error('Codex 工具调用身份无效或重复');seen.add(input.callId);
    const entry=mapping.get(input.tool);
    if(!entry||!allowed.has(input.tool)||!input.arguments||typeof input.arguments!=='object'||Array.isArray(input.arguments))return denied('本轮未提供该工具或参数无效');
    await settle();controller.signal.throwIfAborted();
    const args=input.arguments as Record<string,unknown>,decision=await context.beforeTool({id:input.callId,name:entry.name,input:args});
    controller.signal.throwIfAborted();if(!decision.allow)return denied(decision.reason??'CBIM 未授权该调用');
    await context.emit({type:'tool.started',data:{id:input.callId,name:entry.name}});
    let result:ToolResult;
    try{result=validateToolResult(entry.name,await entry.port.call(entry.name,args,controller.signal,input.callId)) as ToolResult}
    catch(error){result=toolFailureResult(error)}
    result=toolReturnedResult(result);
    await context.emit({type:'tool.finished',data:{id:input.callId,name:entry.name,isError:result.isError===true,result}});
    return {success:result.isError!==true,contentItems:result.content.map(block=>block.type==='text'?{type:'inputText',text:block.text}:{type:'inputImage',imageUrl:'data:'+block.mimeType+';base64,'+block.data})};
  }
  return {registered,catalog,call(input:Parameters<typeof invoke>[0]){const pending=invoke(input);active.add(pending);void pending.then(()=>active.delete(pending),()=>active.delete(pending));return pending},stop(){controller.abort()},async close(){controller.abort();await Promise.allSettled([...active])}};
}
function denied(text:string){return {success:false,contentItems:[{type:'inputText',text}]}}
