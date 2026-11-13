/**
 * 作用定位：Node 环境的 SHA-256 摘要算法，无文件、网络或业务状态。
 * 设计原因：消费者负责选取和编码内容，算法只对实际输入字节求摘要，不混入身份、签名或权限规则。
 */
import {createHash} from 'node:crypto';

/** 字符串按 UTF-8 编码，字节视图仅使用其可见范围；返回小写十六进制，不修改输入。 */
export function sha256(value:string|Uint8Array):string{return createHash('sha256').update(value).digest('hex')}
