/**
 * 作用定位：模型运行快照与凭据加解密端口。
 * 设计原因：配置存储属于应用，各引擎只依赖运行快照，避免 Core 导入主进程存储实现。
 */
import type {LlmDefinition,LlmModel} from './config';
/** 平台加密端口；不可用时拒绝保存密钥，不回退到明文。 */
export interface SecretCipher {available():boolean;encrypt(value:string):string;decrypt(value:string):string}
/** 单次运行的模型快照，只有主进程装配和测试可以取得凭据。 */
export interface ResolvedLlm {profile:Omit<LlmDefinition,'models'|'defaultModel'>&Omit<LlmModel,'id'|'name'|'enabled'>&{id:string;model:string};apiKey:string}
