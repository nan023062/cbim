/**
 * 作用定位：严格 JSON 解析，拒绝重复字段与无效语法。
 * 设计原因：快照读取与规则校验共用解析器，避免领域查询经解析函数依赖整个校验器。
 */
import {parseTree,Node as JsonNode,ParseError,getNodeValue} from 'jsonc-parser';
import {fail} from './errors';
export function parseJson(text:string){
  const errors:ParseError[]=[];const tree=parseTree(text,errors,{disallowComments:true,allowTrailingComma:false});
  if(errors.length||!tree)fail('JSON','JSON 格式无效');
  const visit=(node:JsonNode)=>{if(node.type==='object'){const seen=new Set();for(const property of node.children||[]){const key=property.children![0].value;if(seen.has(key))fail('JSON',`重复 JSON 字段：${key}`);seen.add(key)}}for(const child of node.children||[])visit(child)};visit(tree);return getNodeValue(tree);
}
