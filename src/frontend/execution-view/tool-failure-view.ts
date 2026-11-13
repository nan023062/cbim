/**
 * 作用定位：从已确认执行前拒绝的工具回包提取可读原因，兼容旧校验 JSON。
 * 设计原因：原日志保持不变；只有调用方证实未放行时才转换提示，不能凭正文宣称副作用不存在。
 */
import {inputIssueMessage} from '../../bridge/contracts/execution';

/** 最多解析两层 JSON（旧回包的 message 内含校验数组）；不展示 issue 的原始值。 */
export function rejectedToolView(result:unknown):{message:string;invalidInput:boolean}|undefined{
  let value:unknown=result;
  if(value&&typeof value==='object'&&'content' in value&&Array.isArray(value.content)){
    const blocks=value.content.filter(b=>b?.type==='text'&&typeof b.text==='string');
    if(blocks.length!==1)return;value=blocks[0].text;
  }
  if(typeof value==='string'){const text=value;try{value=JSON.parse(text)}catch{return {message:text,invalidInput:false}}}
  if(value&&typeof value==='object'&&!Array.isArray(value)&&'message' in value&&typeof value.message==='string'){
    const invalidInput='code' in value&&value.code==='TOOL_INPUT_INVALID';
    const message=value.message;
    try{const issues=inputIssueMessage(JSON.parse(message));if(issues)return {message:`参数无效；${issues}。请补齐必填字段或修正格式；可选参数可省略，已声明默认值会自动使用。本次尚未执行。`,invalidInput:true}}catch{/* 普通可读错误不当作 JSON。 */}
    return {message,invalidInput};
  }
  const issues=inputIssueMessage(value);
  return issues?{message:`参数无效；${issues}。本次尚未执行。`,invalidInput:true}:undefined;
}
