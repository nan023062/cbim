/**
 * 目录归属：logic/models；模型目录与纯选型规则。
 * 作用定位：模型运行快照与凭据加解密端口。
 * 设计原因：各引擎只依赖运行快照，平台经端口提供加密；纯模型契约不导入配置服务或主进程实现。
 */
import type {LlmDefinition,LlmModel} from './config';
import type {LoopEngine} from './engine';
/** 平台加密端口；不可用时拒绝保存密钥，不回退到明文。 */
export interface SecretCipher {available():boolean;encrypt(value:string):string;decrypt(value:string):string}
/** 单次运行的模型快照；仅冻结选中的接口，不携带候选地址或自动识别策略，旧缺省 Pi 保持原字节。只有主进程装配和测试可以取得凭据。 */
export interface ResolvedLlm {profile:Omit<LlmDefinition,'models'|'defaultModel'|'engine'|'autoDetect'|'alternateConnections'>&Omit<LlmModel,'id'|'name'|'enabled'>&{id:string;model:string;engine?:LoopEngine};apiKey:string}
