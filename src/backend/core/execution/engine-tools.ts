/**
 * 目录归属：backend/core/execution；运行协议与计量。
 * 作用定位：将可信装配注入的能力组装成引擎无关的目录与调用端口。
 * 设计原因：Pi、Claude Code 与 Codex 只适配传输；真实调用 ID、取消信号和能力归属保持同一契约。
 */

export interface EngineToolSchema {name:string;description?:string;inputSchema:Record<string,unknown>}
export interface EngineToolsPort {
  list():Promise<EngineToolSchema[]>;
  /** 身份来自已授权的原生工具调用，不能从模型参数推断。 */
  call(name:string,args:Record<string,unknown>,signal:AbortSignal,toolCallId?:string):Promise<unknown>;
}
/** 一轮运行的可信能力声明；id 仅用于诊断，指令不能授予工具目录以外的权限。 */
export interface EngineCapability {
  id:string;
  tools:EngineToolsPort;
  instructions?:readonly string[];
  /** 本轮只能使用显式能力工具时关闭全部原生文件与命令，不能由模型输入更改。 */
  disableNativeTools?:boolean;
}
export interface EngineCapabilities {capabilities?:readonly EngineCapability[]}
export function nativeToolsDisabled(context:EngineCapabilities):boolean {
  return context.capabilities?.some(capability=>capability.disableNativeTools===true)??false;
}
/** 启动时捕获一次工具路由；失败不会重试写操作，也不会注册未注入的成员能力。 */
export async function runtimeEngineTools(context:EngineCapabilities,knowledge:EngineToolsPort):Promise<EngineToolsPort>{
  const ports:EngineToolsPort[]=[knowledge,...(context.capabilities??[]).map(capability=>capability.tools)];
  const routes=new Map<string,EngineToolsPort>(),catalog:EngineToolSchema[]=[];
  for(const port of ports)for(const tool of await port.list()){
    if(!/^cbim_[a-z0-9_]+$/.test(tool.name)||routes.has(tool.name))throw Error('运行工具名称无效或重复：'+tool.name);
    routes.set(tool.name,port);catalog.push(structuredClone(tool));
  }
  return {list:async()=>structuredClone(catalog),call:(name,args,signal,id)=>{
    const port=routes.get(name);if(!port)throw Error('本轮未注册该工具');return port.call(name,args,signal,id);
  }};
}
