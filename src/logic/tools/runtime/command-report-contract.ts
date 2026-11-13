/**
 * 作用定位：声明主调度原命令核实工具的只读元数据及唯一 wire 归属校验。
 * 设计原因：报告复用服务但不成为第九种写命令；当前 root 由闭包固定，旧 run/call 可明确查询，不能借结果更换身份。
 */
import {zodToJsonSchema} from 'zod-to-json-schema';
import {fail} from '../../../core/errors';
import {commandVerificationReportSchema,commandVerificationReportForInput,commandVerificationLimits,commandReportToolName,type CommandVerificationInput} from '../../tasks/rules/command-verification';
import {checkedJsonToolResult} from '../rules/results';
import type {ToolCancellation,ToolRecovery} from '../rules/contracts';

export function commandReportContract(){
  const cancellation:ToolCancellation={mode:'preflight_only',description:'读取前后复核本次取消；不改变原命令、日志或恢复状态。'};
  const recovery:ToolRecovery={mode:'read_again',description:'可显式重读原 run/toolCall 的事实；查无回执不证明未执行，不自动重放。'};
  return {version:1,outputSchema:zodToJsonSchema(commandVerificationReportSchema) as Record<string,unknown>,cancellation,recovery};
}
/** 只编码一次；坏返回不改成成功，不再次调用服务，也不回显私有正文。 */
export function checkedCommandReportResult(value:unknown,identity:CommandVerificationInput){
  const result=checkedJsonToolResult(commandReportToolName,value,commandVerificationReportForInput(identity));
  if(Buffer.byteLength(result.content[0].text,'utf8')>commandVerificationLimits.outputBytes)fail('TOOL_OUTPUT_INVALID','原命令报告超出公开输出上限，未自动重新查询。');
  return result;
}
