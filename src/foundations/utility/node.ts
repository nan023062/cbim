/**
 * 作用定位：utility 的 Node 专属公开入口，当前提供 SHA-256 摘要。
 * 设计原因：把 Node 依赖与通用算法隔离；直接承载现有算法，避免仅为转发增加一层文件。
 * 职责边界：仅计算输入字节摘要，字段选择、身份、签名、权限和 I/O 由消费者负责。
 */
import {createHash} from 'node:crypto';

/** 字符串按 UTF-8 编码，字节视图仅使用其可见范围；返回小写十六进制，不修改输入。 */
export function sha256(value:string|Uint8Array):string{return createHash('sha256').update(value).digest('hex')}
