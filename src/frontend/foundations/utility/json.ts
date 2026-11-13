/**
 * 作用定位：前端域的 JSON 比较工具，供页面控制器核对请求、预览和回执中的值。
 * 设计原因：组合共享 Core 的排序算法并保留前端比较策略，业务身份和接受条件仍由各控制器判断。
 * 职责边界：只比较值，不校验 Schema、不生成持久指纹、不读写状态或发起请求。
 */

import {orderJsonValue} from '../../../core/utility';

/** 策略属于前端比较契约，不改变后端其他调用方的字典序或字段保留规则。 */
const orderedJson=(value:unknown)=>orderJsonValue(value,{compareKeys:(left,right)=>left.localeCompare(right),omitUndefinedProperties:true});

/**
 * 比较对象键排序后的 JSON 文本，不修改输入；数组次序保留，对象 undefined 属性省略。
 * 调用方负责提供 JSON 形状的数据及业务校验。数组空位/undefined、非有限数字沿用 JSON.stringify 语义；
 * 顶层不可序列化值仍可比较为相同，BigInt、循环引用或属性读取失败仍抛错，不伪装成“不相等”。
 * localeCompare 取决于运行环境且可能将不同键视为同序；不承诺跨环境 canonical 或通用深相等。
 */
export function equalJson(left:unknown,right:unknown):boolean {
  return JSON.stringify(orderedJson(left))===JSON.stringify(orderedJson(right));
}
