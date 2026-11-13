/**
 * 作用定位：前端域通用工具函数与数据结构的公开入口，当前提供 JSON 比较和实例订阅集合。
 * 设计原因：消费者通过稳定入口组合前端基础能力，类别文件保持私有；不借 bridge 复用后端工具。
 */
export {equalJson} from './json';
export {SubscriptionSet} from './events';
