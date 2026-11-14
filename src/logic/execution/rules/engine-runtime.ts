/**
 * 作用定位：执行装配向引擎适配器传递的已解析运行包契约，不包含下载、签名或安装实现；adapter 与 SDK 入口、版本分别保存。
 * 设计原因：将进程入口与账号/历史目录分开；每次装配冻结具体包，运行中不重新读取“最新版”。
 */
export interface EngineRuntimePackage {root:string;version:string;entry:string;identity:string;adapter?:{entry:string;version:string;protocol:1}}
/** 主进程私有端口；调用可等待首次准备，失败不启动引擎；绝不由模型或公开运行参数提供路径。 */
export interface EngineRuntimeResolver {
  resolveEngine(kind:string):Promise<EngineRuntimePackage>;
}
