/**
 * 作用定位：Core 既有 hash/json 名称的兼容适配，算法实现归本目录独立 utility 子库。
 * 设计原因：知识版本及幂等指纹保留原字节、错误和导入契约；重导出唯一实现，避免全仓消费者同时改名。
 */
export {sha256 as hash} from './utility/node';
export {formatJson as json} from './utility';
