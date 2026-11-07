/**
 * 作用定位：绑定主调度十项工具的公开回包、取消恢复说明及可信命令键，检查点放弃使用独立命令域。
 * 设计原因：提交方和输出核验共用原 run/call 映射；只在一次序列化的 wire 上核对业务结构与归属，不重新执行动作，也不把回包失败解释为回滚。
 */
import {zodToJsonSchema} from 'zod-to-json-schema';
import {hash,json} from '../../core/foundation/serialization';
import {mainToolOutputSchema,mainToolOutputSchemas,type MainToolName,type MainToolOutputBinding} from '../../core/tasks/main-tool-output';
import type {ToolCancellation,ToolRecovery} from '../../core/tools/contracts';
import {checkedJsonToolResult} from '../../core/tools/results';

/** 保留已落盘命令的映射格式；只读工具没有命令，模型不能提供或替换此键。 */
export function mainToolCommandId(name:MainToolName,binding:MainToolOutputBinding,toolCallId:string):string|undefined{
  if(name==='cbim_goal_inspect'||name==='cbim_dispatch_inspect')return undefined;
  if(name==='cbim_goal_plan'||name==='cbim_goal_review')return (name==='cbim_goal_plan'?'auto-goal-plan-':'auto-goal-review-')+hash(binding.runId+':'+toolCallId);
  const prefix={cbim_dispatch_task:'auto-task-',cbim_dispatch_cancel:'auto-cancel-',cbim_dispatch_replace_dependency:'auto-dependency-',cbim_dispatch_add_dependency:'auto-add-dependency-',cbim_dispatch_resume:'auto-resume-',cbim_dispatch_abandon_checkpoint:'auto-abandon-checkpoint-'}[name];
  return prefix+hash(json({identity:{workspaceId:binding.workspaceId,rootSessionId:binding.rootSessionId},runId:binding.runId,toolCallId}));
}

/** 元数据仅描述当前主工具，不扩充知识目录或赋予成员调度权限。 */
export function mainToolContract(name:MainToolName){
  const read=name==='cbim_goal_inspect'||name==='cbim_dispatch_inspect';
  const cancellation:ToolCancellation={mode:'preflight_only',description:'入口先检查取消，服务在支持的受理前边界复核；进入事务后不承诺中断或回滚，返回失败仍可能已有记录。'};
  const recovery:ToolRecovery=read
    ?{mode:'read_again',description:'可显式重新读取当前事实；新结果不代表旧时刻的快照，不触发执行。'}
    :{mode:'inspect_before_retry',queryTool:name.startsWith('cbim_goal_')?'cbim_goal_inspect':'cbim_dispatch_inspect',description:'先核实原目标或任务事实。可信原 run/toolCall 对应稳定命令；模型再次调用会产生新请求，不能以新调用重放未知结果，查询也不自动恢复执行。'};
  return {version:name==='cbim_goal_plan'||name==='cbim_dispatch_task'?2:1,outputSchema:zodToJsonSchema(mainToolOutputSchemas[name]) as Record<string,unknown>,cancellation,recovery};
}

/** 领域方法已执行后只校验这一次原 wire；不得对 Schema 解析结果重新编码或重新提交。 */
export function checkedMainToolResult(name:MainToolName,value:unknown,binding:MainToolOutputBinding,input:unknown,toolCallId:string){
  return checkedJsonToolResult(name,value,mainToolOutputSchema(name,{binding,input,expectedCommandId:mainToolCommandId(name,binding,toolCallId)}));
}
