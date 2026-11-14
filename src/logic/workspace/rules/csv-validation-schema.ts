/**
 * 作用定位：定义冻结 CSV 表格要求并直接检查有界 UTF-8 字节，供知识声明与可信文件端口共用。
 * 设计原因：表头、列类型和唯一键必须来自事先约定，不能猜分隔符、转换坏值或相信模型自报行数。
 * 职责边界：支持逗号、双引号转义、CRLF/LF；不执行公式、不读取外部数据，诊断只含位置和规则名。
 */
import {z} from 'zod';
import {fail} from '../../../core/errors';

/** 文件大小单位为字节，字段长度按 Unicode 码点；行数不含必须存在的表头。 */
export const csvValidationLimits={fileBytes:1024*1024,schemaBytes:32*1024,rows:10000,columns:32,fieldChars:4096,issues:16} as const;
const name=z.string().min(1).max(80).refine(value=>value.trim()===value&&!/[\x00-\x1f]/.test(value));
const stringColumn=z.object({name,type:z.literal('string'),minLength:z.number().int().min(0).max(csvValidationLimits.fieldChars).optional(),maxLength:z.number().int().min(0).max(csvValidationLimits.fieldChars).optional(),enum:z.array(z.string().max(csvValidationLimits.fieldChars)).min(1).max(32).optional()}).strict();
const numeric={name,minimum:z.number().finite().optional(),maximum:z.number().finite().optional()};
const column=z.discriminatedUnion('type',[stringColumn,z.object({...numeric,type:z.literal('integer')}).strict(),z.object({...numeric,type:z.literal('number')}).strict()]).superRefine((value,ctx)=>{
  if(value.type==='string'){
    if(value.minLength!==undefined&&value.maxLength!==undefined&&value.minLength>value.maxLength)ctx.addIssue({code:'custom',message:'字符串长度上下界矛盾'});
    if(value.enum&&new Set(value.enum).size!==value.enum.length)ctx.addIssue({code:'custom',message:'字符串枚举不能重复'});
  }else if(value.minimum!==undefined&&value.maximum!==undefined&&value.minimum>value.maximum)ctx.addIssue({code:'custom',message:'数值上下界矛盾'});
});
/** 列顺序及表头是精确约定；省略行数限制只使用产品上限，省略唯一键不暗中增加业务规则。 */
export const csvTableSchema=z.object({
  columns:z.array(column).min(1).max(csvValidationLimits.columns),
  minRows:z.number().int().min(0).max(csvValidationLimits.rows).optional(),
  maxRows:z.number().int().min(0).max(csvValidationLimits.rows).optional(),
  uniqueBy:z.array(name).min(1).max(csvValidationLimits.columns).optional(),
}).strict().superRefine((value,ctx)=>{
  if(new TextEncoder().encode(JSON.stringify(value)).byteLength>csvValidationLimits.schemaBytes)ctx.addIssue({code:'custom',message:'CSV声明超过32KiB'});
  const names=value.columns.map(item=>item.name);
  if(new Set(names).size!==names.length)ctx.addIssue({code:'custom',message:'表头不能重复'});
  if(value.minRows!==undefined&&value.maxRows!==undefined&&value.minRows>value.maxRows)ctx.addIssue({code:'custom',message:'数据行上下界矛盾'});
  if(value.uniqueBy&&(new Set(value.uniqueBy).size!==value.uniqueBy.length||value.uniqueBy.some(key=>!names.includes(key))))ctx.addIssue({code:'custom',message:'唯一键必须引用不重复的现有列'});
});
export type CsvTableSchema=z.infer<typeof csvTableSchema>;
export type CsvValidationIssueCode='csv_invalid'|'csv_header'|'csv_columns'|'csv_value'|'csv_duplicate'|'csv_rows';
export interface CsvValidationOutcome {outcome:'passed'|'rejected';issues:Array<{code:CsvValidationIssueCode;instancePath:string;keyword?:string}>}

/** 单次完整解析；超出产品预算抛出错误而非截断出“已验证”结果。空行也是记录，不被忽略。 */
function parseTable(text:string):string[][]|undefined{
  const rows:string[][]=[];let row:string[]=[],field='',state:'plain'|'quoted'|'closed'='plain';
  let chars=0,recordStarted=false;
  const append=(value:string)=>{field+=value;if(++chars>csvValidationLimits.fieldChars)fail('VALIDATION_LIMIT','CSV 字段超过 4096 字符')};
  const finishField=()=>{row.push(field);if(row.length>csvValidationLimits.columns)fail('VALIDATION_LIMIT','CSV 超过 32 列');field='';chars=0;state='plain'};
  const finishRow=()=>{finishField();rows.push(row);if(rows.length>csvValidationLimits.rows+1)fail('VALIDATION_LIMIT','CSV 超过 10000 条数据行');row=[];recordStarted=false};
  for(let index=0;index<text.length;index++){
    const char=String.fromCodePoint(text.codePointAt(index)!);if(char.length===2)index++;
    if(char==='\0')return;
    if(state==='quoted'){
      if(char==='"'){if(text[index+1]==='"'){append('"');index++}else state='closed'}
      else if(char==='\r'){if(text[index+1]!=='\n')return;append('\r');append('\n');index++}
      else append(char);
      continue;
    }
    if(char===','){finishField();recordStarted=true;continue}
    if(char==='\r'||char==='\n'){if(char==='\r'){if(text[index+1]!=='\n')return;index++}finishRow();continue}
    if(state==='closed')return;
    if(char==='"'){if(field.length)return;state='quoted';recordStarted=true;continue}
    append(char);recordStarted=true;
  }
  if(state==='quoted')return;
  if(recordStarted||row.length||field.length||state==='closed')finishRow();
  return rows;
}

/** 同一实际文件的完整字节判定；无正文、单元格值或唯一键值返回调用者。 */
export function validateCsvArtifact(rawSchema:CsvTableSchema,bytes:Uint8Array):CsvValidationOutcome{
  const parsed=csvTableSchema.safeParse(rawSchema);if(!parsed.success)fail('VALIDATION_SCHEMA_INVALID','CSV 验证声明不受支持或超过边界');
  if(!(bytes instanceof Uint8Array)||bytes.byteLength>csvValidationLimits.fileBytes)fail('VALIDATION_LIMIT','CSV 产物超过 1 MiB');
  const schema=parsed.data,issues:CsvValidationOutcome['issues']=[],add=(code:CsvValidationIssueCode,instancePath:string,keyword?:string)=>{if(issues.length<csvValidationLimits.issues)issues.push({code,instancePath,...(keyword?{keyword}:{})})};
  let text:string;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes)}catch{return {outcome:'rejected',issues:[{code:'csv_invalid',instancePath:'',keyword:'utf8'}]}}
  const rows=parseTable(text);if(!rows)return {outcome:'rejected',issues:[{code:'csv_invalid',instancePath:'',keyword:'syntax'}]};
  if(!rows.length||rows[0].length!==schema.columns.length||schema.columns.some((item,index)=>rows[0][index]!==item.name))return {outcome:'rejected',issues:[{code:'csv_header',instancePath:'/header'}]};
  if(rows.length-1<(schema.minRows??0)||rows.length-1>(schema.maxRows??csvValidationLimits.rows))add('csv_rows','','rowCount');
  const keyIndexes=schema.uniqueBy?.map(key=>schema.columns.findIndex(item=>item.name===key)),keys=new Set<string>();
  for(let index=1;index<rows.length;index++){
    const row=rows[index],position='/rows/'+index;
    if(row.length!==schema.columns.length){add('csv_columns',position,'columnCount');continue}
    for(let col=0;col<row.length;col++){
      const rule=schema.columns[col],value=row[col],at=position+'/'+col;
      if(rule.type==='string'){
        const length=[...value].length;
        if(length<(rule.minLength??0)||length>(rule.maxLength??csvValidationLimits.fieldChars))add('csv_value',at,'length');
        if(rule.enum&&!rule.enum.includes(value))add('csv_value',at,'enum');
      }else{
        // 接受明确十进制及数值指数；空白、空值、十六进制、NaN/Infinity 不转换成有效数字。
        const syntax=rule.type==='integer'?/^-?(?:0|[1-9]\d*)$/:/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
        const number=Number(value);
        if(!syntax.test(value)||!Number.isFinite(number)||rule.type==='integer'&&!Number.isSafeInteger(number))add('csv_value',at,rule.type);
        else if(rule.minimum!==undefined&&number<rule.minimum||rule.maximum!==undefined&&number>rule.maximum)add('csv_value',at,'range');
      }
    }
    if(keyIndexes){const key=JSON.stringify(keyIndexes.map(col=>row[col]));if(keys.has(key))add('csv_duplicate',position,'uniqueBy');keys.add(key)}
  }
  return {outcome:issues.length?'rejected':'passed',issues};
}
