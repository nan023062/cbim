/**
 * 目录归属：logic/models；模型目录与纯选型规则。
 * 作用定位：模型运行快照与凭据加解密端口。
 * 设计原因：各引擎只依赖运行快照，平台经端口提供加密；纯模型契约不导入配置服务或主进程实现。
 */
import type {LlmDefinition,LlmModel} from './config';
import type {ResolvedEmbedding} from './embedding';

/** 平台加密端口；不可用时拒绝保存密钥，不回退到明文。 */
export type {SecretCipher} from '../../core/contracts/secrets';
/** 单次运行的模型快照；仅冻结选中的接口，不携带候选地址或自动识别策略，不包含引擎身份。只有主进程装配和测试可以取得凭据。 */
export interface ResolvedLlm {profile:Omit<LlmDefinition,'models'|'defaultModel'|'engine'|'autoDetect'|'alternateConnections'|'embedding'>&Omit<LlmModel,'id'|'name'|'enabled'>&{id:string;model:string};apiKey:string}
/** 单个已解析操作；操作能力由 profile 的协议与 kind 明确区分，凭据不进入公开快照。 */
export interface ResolvedModelOperation {profile:ResolvedLlm['profile']|ResolvedEmbedding['profile'];apiKey:string}
