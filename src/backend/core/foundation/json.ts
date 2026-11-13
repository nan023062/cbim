/**
 * 作用定位：将 utility 的严格 JSON 解析事实适配为 Core 原有 JSON 错误协议。
 * 设计原因：语法算法独立复用，快照与规则消费者继续得到同一 Fault.code、name 和提示。
 */
import {parseStrictJson,StrictJsonError} from '../../../foundations/utility';
import {fail} from './errors';
/** 不改变字段及资源限制；只将已知解析失败转换为原 JSON 领域错误，其他异常原样传播。 */
export function parseJson(text:string){
  try{return parseStrictJson(text)}catch(error){if(error instanceof StrictJsonError)fail('JSON',error.message);throw error}
}
