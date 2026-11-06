/**
 * 作用定位：向界面公开 Core 的纯执行计量函数及单轮用量类型。
 * 设计原因：前端和全局运行监管共享同一计量口径，通信边界不依赖磁盘、调度实现或原生引擎。
 */
export {runUsage,taskUsage,runDuration,tokenCount,durationText} from '../../backend/core/brain/usage';
export type {RunUsage} from '../../backend/core/brain/usage';
