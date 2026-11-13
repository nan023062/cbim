/**
 * 作用定位：将工具输入校验转换为不含原参数值的字段说明，供执行前拒绝与历史展示共用。
 * 设计原因：可选和默认参数由各 Schema 解析；这里只解释实际 issues，不从字段清单推断缺参，也不推断执行是否发生。
 */
import {ZodError} from 'zod';
import {Fault} from '../../../core/errors';

/** 仅接受结构完整的校验问题；未知文本保持调用方原处理，不解释为已知未执行。 */
export function inputIssueMessage(issues:unknown):string|undefined{
  if(!Array.isArray(issues)||!issues.length||!issues.every(i=>i&&typeof i==='object'&&typeof i.code==='string'&&Array.isArray(i.path)&&i.path.every((p:unknown)=>typeof p==='string'||typeof p==='number')))return;
  return issues.slice(0,8).map(i=>`${i.path.join('.')||'参数'}：${i.code==='invalid_type'&&i.received==='undefined'?'缺少必填字段':'类型或格式不符合工具声明'}`).join('；');
}

/** 只在执行前校验边界调用；执行后的 Zod 错误不能据此判为未执行。 */
export function toolInputError(error:unknown):unknown{
  return error instanceof ZodError?new Fault('TOOL_INPUT_INVALID',`参数无效；${inputIssueMessage(error.issues)??'请按工具声明检查参数'}。可选参数可省略，已声明默认值会自动使用；请补齐必填字段或修正格式。本次尚未执行。`):error;
}
