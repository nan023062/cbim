/**
 * 作用定位：将运行时注入的任务、知识和成员工具组装成引擎无关的目录与调用端口。
 * 设计原因：Pi、Claude Code 与 Codex 只适配传输；真实调用 ID、取消信号和能力归属保持同一契约。
 */
import type {EngineContext} from './types';

export interface EngineToolSchema {name:string;description?:string;inputSchema:Record<string,unknown>}
export interface EngineToolsPort {
  list():Promise<EngineToolSchema[]>;
  /** 身份来自已授权的原生工具调用，不能从模型参数推断。 */
  call(name:string,args:Record<string,unknown>,signal:AbortSignal,toolCallId?:string):Promise<unknown>;
}
/** 启动时捕获一次工具路由；失败不会重试写操作，也不会注册未注入的成员能力。 */
export async function runtimeEngineTools(context:EngineContext,knowledge:EngineToolsPort):Promise<EngineToolsPort>{
  const ports:EngineToolsPort[]=[knowledge];
  for(const port of [context.taskTools,context.memberHelpTools,context.artifactTools,context.manifestTools,context.memberCheckpointTools,context.validationTools])if(port)ports.push({list:()=>port.list(),call:(name,args,_signal,id)=>port.call(name,args,id!)});
  for(const port of [context.controlledFileTools,context.artifactTransitionTools,context.scopedExecutionTools])if(port)ports.push({list:()=>port.list(),call:(name,args,signal,id)=>port.call(name,args,id!,signal)});
  const routes=new Map<string,EngineToolsPort>(),catalog:EngineToolSchema[]=[];
  for(const port of ports)for(const tool of await port.list()){
    if(!/^cbim_[a-z0-9_]+$/.test(tool.name)||routes.has(tool.name))throw Error('运行工具名称无效或重复：'+tool.name);
    routes.set(tool.name,port);catalog.push(tool);
  }
  return {list:async()=>structuredClone(catalog),call:(name,args,signal,id)=>{
    const port=routes.get(name);if(!port)throw Error('本轮未注册该工具');return port.call(name,args,signal,id);
  }};
}
