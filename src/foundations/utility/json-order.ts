/**
 * 作用定位：递归复制 JSON 形状的值并排列对象键，不序列化、不计算指纹。
 * 设计原因：共享遍历机制，比较器及 undefined 字段规则由历史协议的消费者明确选择。
 */
export interface JsonKeyOrder {
  /** 必须显式指定；localeCompare 依赖运行环境，不能作为跨环境唯一 canonical 标准。 */
  compareKeys:(left:string,right:string)=>number;
  /** 仅省略对象的 undefined 属性；数组顺序、空位及元素保持原义。 */
  omitUndefinedProperties?:boolean;
}

/**
 * 不修改输入，只遍历自身可枚举字符串键；整数键仍遵循 JS 对象枚举规则。
 * 面向既有 JSON 快照，不做 Schema/危险键过滤、循环检测、深度限制或自定义 toJSON 处理。
 * 非 JSON 对象与访问器由调用者约束，比较/读取错误原样传播。
 */
export function orderJsonValue(value:unknown,policy:JsonKeyOrder):unknown {
  const visit=(item:unknown):unknown=>{
    if(Array.isArray(item))return item.map(visit);
    if(item&&typeof item==='object')return Object.fromEntries(Object.entries(item)
      .filter(([,entry])=>!policy.omitUndefinedProperties||entry!==undefined)
      .sort(([a],[b])=>policy.compareKeys(a,b)).map(([key,entry])=>[key,visit(entry)]));
    return item;
  };
  return visit(value);
}
