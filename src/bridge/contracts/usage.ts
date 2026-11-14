/**
 * 作用定位：向界面公开 Logic 执行规则的纯计量函数及单轮用量类型。
 * 设计原因：前端和全局运行监管共享同一计量口径，通信边界不依赖磁盘、调度实现或原生引擎。
 */
export {runUsage,taskUsage,runDuration,tokenCount,durationText} from '../../logic/execution/rules/usage';
export type {RunUsage} from '../../logic/execution/rules/usage';
