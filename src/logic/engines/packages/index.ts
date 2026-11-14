/**
 * 作用定位：官方引擎安装生命周期的服务入口。
 * 设计原因：Node 存储与便携模型兼容规则隔离，View 只通过桥接契约访问状态与明确动作。
 */
export {EnginePackages} from './engine-packages';
export type {EnginePackageStatus} from './engine-packages';
