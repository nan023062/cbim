/**
 * 作用定位：保留对话界面的用量统计入口，经桥接契约使用 Core 的纯计量函数。
 * 设计原因：全局运行监管与任务界面必须共享计费和 token 口径；保留此入口让现有组件与历史展示不受迁移影响。
 */
export {taskUsage,runDuration,tokenCount,durationText} from '../../bridge/contracts/usage';
