/**
 * 作用定位：旧 Main 锁入口的兼容出口，供工作区、资源和执行装配继续使用。
 * 设计原因：唯一原生实现已迁到 Core；重导出同一构造器与持有集合，避免迁移期间产生两套锁状态。
 */
export {KernelLock} from '../../../core/platform/node/locking';
