/**
 * 作用定位：R 引擎管理与 C 制品验证之间的便携窄端口。
 * 设计原因：冷壳只认识签名制品身份、依赖和通用协议；支持名单、安装选择和 Agent 引用归 R，不在这里注册引擎。
 */
export interface EngineArtifact {
  kind:string;identity:string;version:string;nativeVersion:string;protocol:1;
  dependencies:readonly {kind:string;identity:string}[];
}
/** 地址仅在完整校验后由可信宿主返回；调用者不能提交文件路径或 URL。 */
export interface PreparedEngineArtifact {
  root:string;version:string;entry:string;identity:string;
  adapter:{entry:string;version:string;protocol:1};
}
export interface EngineArtifactsPort {
  /** 离线列出已验签候选；未知身份不接受 prepare。 */
  list():Promise<{current:EngineArtifact[];available:EngineArtifact[]}>;
  /** 仅发现，不下载 E 或切换本机活动版本；失败保留上次可信索引。 */
  check():Promise<void>;
  /** 进度包含缓存校验和下载准备，不代表已激活；旧冷宿主可忽略可选回调。 */
  prepare(kind:string,identity:string,onProgress?:(progress:number)=>void):Promise<PreparedEngineArtifact>;
}
