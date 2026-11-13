/**
 * 作用定位：模型配置服务的宿主公共入口，供应用装配及主 Agent 设置使用。
 * 设计原因：文件持久化、联网探测与凭据解析不能被纯模型规则入口加载；此入口只允许服务端消费者。
 */
export {LlmProfiles} from './llm-profiles';
export type {ExplicitModelReference,LockedModelConfiguration,LlmDefinition,LlmProfile,LlmSettings,SecretCipher,ResolvedLlm} from './llm-profiles';
