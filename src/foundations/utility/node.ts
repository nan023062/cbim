/**
 * 作用定位：utility 需要 Node 标准库的独立公开入口。
 * 设计原因：显式区分运行环境，通用入口使用队列或格式化时不会连带加载 node:crypto。
 */
export {sha256} from './digest';
