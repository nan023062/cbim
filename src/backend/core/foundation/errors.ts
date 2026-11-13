/**
 * 作用定位：旧后端调用方使用的错误兼容出口，统一指向共享 Core。
 * 设计原因：迁移中的领域仍使用此入口；保留同一个 Fault 构造器和错误码，新 Logic 直接使用 Core。
 */
export {Fault,fail} from '../../../core/errors';
