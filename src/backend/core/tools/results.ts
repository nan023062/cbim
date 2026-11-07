/**
 * 作用定位：校验内部工具传给大脑的结果，并将领域返回值封装为合法文本块。
 * 设计原因：工具外壳与业务字段都需核验；固定唯一 JSON 快照，防缺字段、Schema 改写或重复序列化补造成功，同时拒绝会污染会话的缺失 text。
 * 职责边界：只检查返回协议，不重放工具；校验失败不代表工具的既有副作用已回滚。
 */
import {fail} from '../foundation/errors';
import {isDeepStrictEqual} from 'node:util';
import type {z} from 'zod';

/** 当前内部工具支持文本与图片；返回给模型的文本必须是字符串，不能依靠隐式转换。 */
export type ToolResultContent={type:'text';text:string}|{type:'image';data:string;mimeType:string};
export interface ToolResult {
  content:ToolResultContent[];
  /** true 表示工具明确失败；内容有效不代表业务执行成功。 */
  isError?:boolean;
  details?:unknown;
}

function invalid(name:string,reason:string):never{
  fail('TOOL_RESULT_INVALID',`${name} 返回无效工具结果：${reason}。请核实已有操作，不自动重试。`);
}

/** 不回显结果正文或序列化异常，避免将私密数据带进错误消息。 */
function encode(name:string,value:unknown):string{
  let encoded:string|undefined;
  try{encoded=JSON.stringify(value)}catch{invalid(name,'结果无法序列化为 JSON')}
  if(typeof encoded!=='string')invalid(name,'结果不能为 undefined 或不可序列化值');
  return encoded;
}

/** 包装确定的领域返回值；null 是显式结果，undefined 必须由领域接口改为明确状态或错误。 */
export function jsonToolResult(name:string,value:unknown):{content:{type:'text';text:string}[]}{
  return {content:[{type:'text',text:encode(name,value)}]};
}

/**
 * 领域调用完成后只生成一次 JSON 字节快照；严格核验同一快照，实际发送原编码，不采用 Schema 改写的数据。
 * 错误只报告结构位置/类别。操作可能已经发生，返回无效不代表回滚，调用方不得自动重试领域调用。
 */
export function checkedJsonToolResult(name:string,value:unknown,schema:z.ZodTypeAny):{content:{type:'text';text:string}[]}{
  const reject=(category:string,path:readonly(string|number)[]=[]):never=>{
    // record 的动态键可能含正文或凭据，位置仅保留层级和数组索引，不把 Zod message / keys 回显。
    const location='output'+path.map(part=>typeof part==='number'?'['+part+']':'.<field>').join('');
    return fail('TOOL_OUTPUT_INVALID',`${name} 业务输出无效（位置 ${location}；类别 ${category}）。操作可能已经发生，请核实已有记录，不自动重试。`);
  };
  const encoded=(()=>{try{const encoded=JSON.stringify(value);return typeof encoded==='string'?encoded:reject('serialization')}catch{return reject('serialization')}})();
  const wire:unknown=JSON.parse(encoded);
  // Schema 的自定义校验也可能原地修改参数；隔离输入，才能与不可变的实际发送快照核对。
  const checked=(()=>{try{return schema.safeParse(structuredClone(wire))}catch{return reject('schema_exception')}})();
  if(!checked.success){const issue=checked.error.issues[0];return reject(issue?.code??'schema',issue?.path)}
  if(!isDeepStrictEqual(wire,checked.data))reject('schema_changed_output');
  return {content:[{type:'text',text:encoded}]};
}

/**
 * 校验实际 JSON 传输形态并返回该快照，阻止 toJSON 或 undefined 字段在发送时改变协议。
 * 可用于已有具体结果类型；不执行工具、不授予权限，不自动把缺失内容补成成功结果。
 */
export function validateToolResult<T>(name:string,value:T):T{
  const wire=JSON.parse(encode(name,value));
  if(!wire||typeof wire!=='object'||Array.isArray(wire)||!Array.isArray(wire.content))invalid(name,'缺少 content 数组');
  if(wire.isError!==undefined&&typeof wire.isError!=='boolean')invalid(name,'isError 必须为布尔值');
  for(const block of wire.content){
    if(!block||typeof block!=='object'||Array.isArray(block))invalid(name,'内容块必须为对象');
    if(block.type==='text'){
      if(typeof block.text!=='string')invalid(name,'text 内容块缺少字符串 text');
    }else if(block.type==='image'){
      if(typeof block.data!=='string'||!block.data||typeof block.mimeType!=='string'||!/^image\/[a-z0-9.+-]+$/i.test(block.mimeType))invalid(name,'图片内容块缺少 data 或有效 mimeType');
    }else invalid(name,'不支持的内容块类型');
  }
  return wire as T;
}
