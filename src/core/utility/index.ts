/**
 * 作用定位：通用数据处理算法与实例内数据结构的公开入口，无 Node 或业务依赖。
 * 设计原因：按能力导出静态工具类和实例数据结构，避免万能 Utility 类及隐式共享状态；Node 算法由独立入口提供。
 * 实现形式：具名重导出模块，消费者不穿透类别文件；静态方法不依赖 this。
 */
/** 每实例独立的串行队列、在途集合及请求关联表。 */
export { SerialQueue, InFlightOperations, PendingRequests, type PendingReply } from './async';

/** 纯有向图结构算法。 */
export { GraphUtils } from './graphs';
