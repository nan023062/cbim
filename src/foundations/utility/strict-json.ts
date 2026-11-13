/**
 * 作用定位：严格 JSON 语法及重复键检查，无领域错误码、Schema 或 I/O。
 * 设计原因：保留现有 jsonc-parser 解析行为，让不同消费者自行解释解析失败与业务校验。
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
