/**
 * 作用定位：通用数据处理算法与实例内数据结构的公开入口，无 Node 或业务依赖。
 * 设计原因：按能力导出具名函数和类，避免万能 Utility 类及隐式共享状态；Node 算法由独立入口提供。
 */
export {formatJson,StrictJsonError,parseStrictJson,orderJsonValue,type JsonKeyOrder} from './json';
export {SerialQueue,InFlightOperations,PendingRequests,type PendingReply} from './async';
export {ByteLimitError,readBoundedBytes} from './bytes';
export {LineFramer,redactLiteral,type LineFramePolicy} from './strings';
