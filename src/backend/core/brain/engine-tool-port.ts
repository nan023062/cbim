/**
 * 作用定位：定义引擎传输与运行能力共同使用的工具目录契约，不认识任何业务工具实现。
 * 设计原因：新增能力只在运行装配处注册，Pi、Claude Code、Codex 和 EngineContext 不再逐个新增业务槽位。
 */
export interface EngineToolSchema {name:string;description?:string;inputSchema:Record<string,unknown>}
/** 适配器传输端口；身份来自已授权的原生调用，不能从模型参数推断。 */
export interface EngineToolsPort {
  list():Promise<EngineToolSchema[]>;
  call(name:string,args:Record<string,unknown>,signal:AbortSignal,toolCallId?:string):Promise<unknown>;
}
/** 运行时能力端口；真实调用 ID 保持原位置，支持停止信号但不授予原生文件或命令能力。 */
export interface RuntimeToolsPort {
  list():Promise<EngineToolSchema[]>;
  call(name:string,args:Record<string,unknown>,toolCallId:string,signal?:AbortSignal):Promise<unknown>;
}
