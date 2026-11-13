/**
 * 作用定位：后端既有 hash/json 名称的兼容适配，格式化来自共享 Core utility，摘要来自独立 Node 入口。
 * 设计原因：知识版本及幂等指纹保留原字节、错误和导入契约；重导出唯一实现，避免全仓消费者同时改名。
 */
export {sha256 as hash} from '../../../core/platform/node/digest';
export {formatJson as json} from '../../../core/utility';
