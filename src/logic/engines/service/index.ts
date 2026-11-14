/**
 * 作用定位：应用装配可用的引擎选型服务入口，与便携清单分离。
 * 设计原因：只有可信 Logic/Bridge 服务接触模型解析与延迟凭据，View 和纯规则不能加载这些能力。
 */
export {EngineModelProfiles} from './model-profiles';
export type {EngineModelReference,LockedEngineModelConfiguration} from './model-profiles';
