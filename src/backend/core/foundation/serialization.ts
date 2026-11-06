/**
 * 作用定位：一致的内容哈希与 JSON 序列化。
 * 设计原因：知识版本及幂等指纹共用确定格式，不承担物理存储。
 */
import {createHash} from 'node:crypto';
export const hash=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
export const json=(v:unknown)=>JSON.stringify(v,null,2)+'\n';
