/**
 * 作用定位：前端域的 JSON 比较工具，供页面控制器核对请求、预览和回执中的值。
 * 设计原因：集中相同的对象键排序规则，业务身份和接受条件仍由各控制器判断；不依赖后端基础库。
 * 职责边界：只比较值，不校验 Schema、不生成持久指纹、不读写状态或发起请求。
 */

/** 复制 JSON 形状的值；保留既有 localeCompare 排序与省略 undefined 对象属性的行为。 */
function orderedJson(value:unknown):unknown {
  if(Array.isArray(value))return value.map(orderedJson);
  if(value&&typeof value==='object'){
    return Object.fromEntries(Object.entries(value)
      .filter(([,entry])=>entry!==undefined)
      .sort(([left],[right])=>left.localeCompare(right))
      .map(([key,entry])=>[key,orderedJson(entry)]));
  }
  return value;
}

/**
 * 比较对象键排序后的 JSON 文本，不修改输入；数组次序保留，对象 undefined 属性省略。
 * 调用方负责提供 JSON 形状的数据及业务校验。数组空位/undefined、非有限数字沿用 JSON.stringify 语义；
 * 顶层不可序列化值仍可比较为相同，BigInt、循环引用或属性读取失败仍抛错，不伪装成“不相等”。
 * localeCompare 取决于运行环境且可能将不同键视为同序；不承诺跨环境 canonical 或通用深相等。
 */
export function equalJson(left:unknown,right:unknown):boolean {
  return JSON.stringify(orderedJson(left))===JSON.stringify(orderedJson(right));
}
