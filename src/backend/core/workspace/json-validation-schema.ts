/**
 * 作用定位：JSON 产物验证的有界声明和纯结构校验，供冻结 Workflow、运行时及知识入口共用。
 * 设计原因：只解释显式白名单，不编译用户代码、不访问引用或转换数据；校验对象来自平台同一次安全读取的原始 UTF-8 字节。
 * 职责边界：只证明指定字节满足指定结构，不证明业务目标、整个工作区或人工验收。
 */
import {z} from 'zod';
import {parseJson} from '../foundation/json';
import {fail} from '../foundation/errors';

export const jsonValidationLimits={fileBytes:1024*1024,schemaBytes:32*1024,schemaDepth:16,schemaNodes:512,dataDepth:64,dataNodes:100000,properties:64,enumValues:64,issues:32,records:16} as const;
type Scalar=string|number|boolean|null;
/** 首片 enum/const 只支持标量；不支持组合、引用、正则、格式或用户可执行关键字。 */
export interface BoundedJsonSchema {
  type:'object'|'array'|'string'|'number'|'integer'|'boolean'|'null';
  enum?:Scalar[];const?:Scalar;
  properties?:Record<string,BoundedJsonSchema>;required?:string[];additionalProperties?:boolean;
  items?:BoundedJsonSchema;minItems?:number;maxItems?:number;
  minLength?:number;maxLength?:number;minimum?:number;maximum?:number;
}
export interface ValidationIssue {code:'json_invalid'|'schema_mismatch';instancePath:string;schemaPath?:string;keyword?:string}
export interface JsonValidationOutcome {outcome:'passed'|'rejected';issues:ValidationIssue[]}
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value)&&[null,Object.prototype].includes(Object.getPrototypeOf(value));
const scalar=(value:unknown):value is Scalar=>value===null||typeof value==='boolean'||typeof value==='string'&&value.length<=4096||typeof value==='number'&&Number.isFinite(value);
const natural=(value:unknown)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0&&value<=jsonValidationLimits.fileBytes;
const allowed={object:['properties','required','additionalProperties'],array:['items','minItems','maxItems'],string:['minLength','maxLength'],number:['minimum','maximum'],integer:['minimum','maximum'],boolean:[],null:[]} as const;
const ofType=(value:unknown,type:BoundedJsonSchema['type'])=>type==='null'?value===null:type==='array'?Array.isArray(value):type==='object'?object(value):type==='integer'?typeof value==='number'&&Number.isInteger(value):typeof value===type&&(type!=='number'||Number.isFinite(value));
/** 原样验证，不裁剪特殊 JSON 键或填充默认值；超界/不支持的声明在执行前明确拒绝。 */
export function isBoundedJsonSchema(value:unknown):value is BoundedJsonSchema{
  try{
    if(new TextEncoder().encode(JSON.stringify(value)).byteLength>jsonValidationLimits.schemaBytes)return false;
    const stack:Array<{value:unknown;depth:number}>=[{value,depth:1}],seen=new Set<object>();let nodes=0;
    while(stack.length){
      const item=stack.pop()!,s=item.value;if(++nodes>jsonValidationLimits.schemaNodes||item.depth>jsonValidationLimits.schemaDepth||!object(s)||seen.has(s)||typeof s.type!=='string'||!Object.hasOwn(allowed,s.type))return false;seen.add(s);
      const type=s.type as BoundedJsonSchema['type'],keys=new Set<string>(['type','enum','const',...allowed[type]]);if(Object.keys(s).some(key=>!keys.has(key)))return false;
      if(Object.hasOwn(s,'enum')&&(!Array.isArray(s.enum)||!s.enum.length||s.enum.length>jsonValidationLimits.enumValues||!s.enum.every(item=>scalar(item)&&ofType(item,type))||new Set(s.enum.map(item=>JSON.stringify(item))).size!==s.enum.length))return false;
      if(Object.hasOwn(s,'const')&&(!scalar(s.const)||!ofType(s.const,type)))return false;
      if(type==='object'){
        if(s.properties!==undefined){if(!object(s.properties)||Object.keys(s.properties).length>jsonValidationLimits.properties)return false;for(const [key,child] of Object.entries(s.properties)){if(!key.length||key.length>256||/[\x00-\x1f]/.test(key))return false;stack.push({value:child,depth:item.depth+1})}}
        if(s.required!==undefined&&(!Array.isArray(s.required)||s.required.length>jsonValidationLimits.properties||!s.required.every(key=>typeof key==='string'&&object(s.properties)&&Object.hasOwn(s.properties,key))||new Set(s.required).size!==s.required.length))return false;
        if(s.additionalProperties!==undefined&&typeof s.additionalProperties!=='boolean')return false;
      }
      if(type==='array'&&s.items!==undefined)stack.push({value:s.items,depth:item.depth+1});
      for(const [min,max] of [['minItems','maxItems'],['minLength','maxLength']] as const){if(s[min]!==undefined&&!natural(s[min])||s[max]!==undefined&&!natural(s[max])||typeof s[min]==='number'&&typeof s[max]==='number'&&s[min]>s[max])return false}
      if(s.minimum!==undefined&&(typeof s.minimum!=='number'||!Number.isFinite(s.minimum))||s.maximum!==undefined&&(typeof s.maximum!=='number'||!Number.isFinite(s.maximum))||typeof s.minimum==='number'&&typeof s.maximum==='number'&&s.minimum>s.maximum)return false;
    }
    return true;
  }catch{return false}
}
export const boundedJsonSchemaSchema=z.custom<BoundedJsonSchema>(isBoundedJsonSchema,'不支持或超过边界的 JSON 验证 Schema').describe('有界 JSON Schema 子集；显式 type，禁止引用、组合、pattern、format、脚本及数据转换');
const escape=(value:string)=>value.replaceAll('~','~0').replaceAll('/','~1');
/** 输入字节同时由可信平台计算指纹；不再次打开文件，非法 UTF-8/重复字段/超深 JSON 均保留 rejected 事实。 */
export function validateJsonArtifact(schema:BoundedJsonSchema,bytes:Uint8Array):JsonValidationOutcome{
  if(!isBoundedJsonSchema(schema))fail('VALIDATION_SCHEMA_INVALID','JSON 验证声明不受支持或超过边界');
  if(!(bytes instanceof Uint8Array)||bytes.byteLength>jsonValidationLimits.fileBytes)fail('VALIDATION_LIMIT','JSON 产物超过 1 MiB 的验证上限');
  let value:unknown;
  try{
    const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);let depth=0,inString=false,escaped=false;
    for(const char of text){if(inString){if(escaped)escaped=false;else if(char==='\\')escaped=true;else if(char==='"')inString=false}else if(char==='"')inString=true;else if(char==='{'||char==='['){if(++depth>jsonValidationLimits.dataDepth)throw Error()}else if(char==='}'||char===']')depth--}
    value=parseJson(text);const stack=[value];let nodes=0;while(stack.length){const item=stack.pop();if(++nodes>jsonValidationLimits.dataNodes||typeof item==='number'&&!Number.isFinite(item))throw Error();if(Array.isArray(item))stack.push(...item);else if(object(item))stack.push(...Object.values(item))}
  }catch{return {outcome:'rejected',issues:[{code:'json_invalid',instancePath:''}]}}
  const issues:ValidationIssue[]=[],stack=[{value,schema,path:'',schemaPath:''}];
  const add=(path:string,schemaPath:string,keyword:string)=>{if(issues.length<jsonValidationLimits.issues)issues.push({code:'schema_mismatch',instancePath:path.slice(0,2048),schemaPath:(schemaPath+'/'+keyword).slice(0,2048),keyword})};
  while(stack.length&&issues.length<jsonValidationLimits.issues){
    const {value:v,schema:s,path:p,schemaPath:q}=stack.pop()!;
    if(!ofType(v,s.type)){add(p,q,'type');continue}
    if(s.enum&&!s.enum.some(item=>item===v))add(p,q,'enum');if(Object.hasOwn(s,'const')&&s.const!==v)add(p,q,'const');
    if(s.type==='object'){
      const o=v as Record<string,unknown>;for(const key of s.required??[])if(!Object.hasOwn(o,key))add(p,q,'required');
      for(const key of Object.keys(o))if(s.properties&&Object.hasOwn(s.properties,key))stack.push({value:o[key],schema:s.properties[key],path:p+'/'+escape(key),schemaPath:q+'/properties/'+escape(key)});else if(s.additionalProperties===false)add(p,q,'additionalProperties');
    }else if(s.type==='array'){
      const a=v as unknown[];if(s.minItems!==undefined&&a.length<s.minItems)add(p,q,'minItems');if(s.maxItems!==undefined&&a.length>s.maxItems)add(p,q,'maxItems');if(s.items)for(let i=a.length-1;i>=0;i--)stack.push({value:a[i],schema:s.items,path:p+'/'+i,schemaPath:q+'/items'});
    }else if(s.type==='string'){
      const length=[...v as string].length;if(s.minLength!==undefined&&length<s.minLength)add(p,q,'minLength');if(s.maxLength!==undefined&&length>s.maxLength)add(p,q,'maxLength');
    }else if(s.type==='number'||s.type==='integer'){if(s.minimum!==undefined&&(v as number)<s.minimum)add(p,q,'minimum');if(s.maximum!==undefined&&(v as number)>s.maximum)add(p,q,'maximum')}
  }
  return {outcome:issues.length?'rejected':'passed',issues};
}
