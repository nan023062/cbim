/**
 * 作用定位：将 utility 的严格 JSON 解析事实适配为 Core 原有 JSON 错误协议。
 * 设计原因：语法算法由共享 Core utility 提供，业务适配只单向引用它；快照与规则消费者继续得到同一 Fault.code、name 和提示。
 * 算法入口：通过 Core JsonUtils 静态方法复用机制，本文件继续拥有原业务策略。
 */
import {JsonUtils, StrictJsonError} from './utility';
import {fail} from './errors';
/** 不改变字段及资源限制；只将已知解析失败转换为原 JSON 领域错误，其他异常原样传播。 */
export function parseJson(text:string){
  try{return JsonUtils.parseStrictJson(text)}catch(error){if(error instanceof StrictJsonError)fail('JSON',error.message);throw error}
}
