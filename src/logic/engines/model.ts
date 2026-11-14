/**
 * 作用定位：引擎执行准备后的模型快照契约，供岗位、任务与装配保存公开参数。
 * 设计原因：引擎身份归执行选型，不进入通用模型连接；兼容旧快照中缺省的 engine，禁止补写影响历史哈希。
 */
import type {ResolvedLlm} from '../models';
import type {LoopEngine} from './catalog/supported-engines';
/** apiKey 只在执行准备期间存在；持久化只使用 profile。engine 缺省时保留缺省。 */
export interface ResolvedEngineModel {profile:ResolvedLlm['profile']&{engine?:LoopEngine};apiKey:string}
