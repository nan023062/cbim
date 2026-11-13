/**
 * 作用定位：JSON 数据处理工具，集中提供格式化、严格解析和递归键排序。
 * 设计原因：按同一数据类别组织具名算法，便于发现和维护；各算法保持独立契约，不互相隐式调用。
 * 职责边界：排序策略由消费者指定，语法事实不等于业务校验，不负责领域字段、指纹或 I/O。
 */
import {parseTree,type Node as JsonNode,type ParseError,getNodeValue} from 'jsonc-parser';

/** 语法错误与重复键分别携带事实；调用者决定对外错误类别与文案。 */
export class StrictJsonError extends SyntaxError {
  constructor(readonly reason:'invalid-syntax'|'duplicate-key',readonly key?:string){
    super(reason==='duplicate-key'?`重复 JSON 字段：${key}`:'JSON 格式无效');this.name='StrictJsonError';
  }
}

/**
 * 拒绝注释、尾逗号、坏语法和同一对象中的重复键（含转义后同名键）。
 * 不改字段、不做 schema、危险键过滤或深度/大小限制；资源上限与输入来源由调用方负责。
 * 返回类型兼容既有动态 JSON 消费者，不宣称数据已经通过业务校验。
 */
export function parseStrictJson(text:string):any{
  const errors:ParseError[]=[];
  const tree=parseTree(text,errors,{disallowComments:true,allowTrailingComma:false});
  if(errors.length||!tree)throw new StrictJsonError('invalid-syntax');
  const visit=(node:JsonNode)=>{
    if(node.type==='object'){
      const seen=new Set();
      for(const property of node.children||[]){
        const key=property.children![0].value;
        if(seen.has(key))throw new StrictJsonError('duplicate-key',key);
        seen.add(key);
      }
    }
    for(const child of node.children||[])visit(child);
  };
  visit(tree);return getNodeValue(tree);
}

/**
 * 保留 JSON.stringify 原语义及属性顺序，不作校验、深拷贝或 canonical 排序。
 * 循环引用与 BigInt 仍抛错；顶层不可序列化值沿旧入口行为返回 "undefined\n"，不是合法 JSON。
 */
export function formatJson(value:unknown):string{return JSON.stringify(value,null,2)+'\n'}

/** 键排序的显式策略；不同历史序列化协议可保留各自规则。 */
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
