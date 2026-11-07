/**
 * 作用定位：为已装配 JSON 验证要求的正式成员提供严格输入、唯一 wire 输出及真实能力说明。
 * 设计原因：模型只选择已有要求与基线；调用端口一次后校验完整绑定和请求，不把 rejected 修复成通过、不自动重读或重试。
 */
import {zodToJsonSchema} from 'zod-to-json-schema';
import {checkedJsonToolResult} from '../tools/results';
import {validationInputSchema,validationOutputSchema,validationToolName,type ValidationBinding,type ValidationInput,type ValidationResult} from './validation';
import {validationRequirement,type ValidationWorkflowBinding} from './validation-evidence';
const same=(a:ValidationBinding,b:ValidationBinding)=>Object.keys(a).length===Object.keys(b).length&&Object.entries(a).every(([key,value])=>b[key as keyof ValidationBinding]===value);
export {validationToolName} from './validation';
/** 真实只读文件操作，作用域仍由运行时注入；Schema 与路径不在模型参数中。 */
export function validationTool(name:string,input:unknown){return name===validationToolName?{args:validationInputSchema.parse(input),effects:['read'] as const,native:false}:undefined}
export class ValidationTools {
  private readonly knowledgeRevision:string;
  private readonly bindings:readonly ValidationWorkflowBinding[];
  constructor(private readonly binding:ValidationBinding,private readonly port:{knowledgeRevision:string;bindings:readonly ValidationWorkflowBinding[];run(input:ValidationInput,toolCallId:string):Promise<ValidationResult>}){this.binding=Object.freeze(structuredClone(binding));this.knowledgeRevision=port.knowledgeRevision;this.bindings=structuredClone(port.bindings)}
  async list(){return [{name:validationToolName,version:1,effects:['read'] as const,description:'按当前模块冻结的 JSON Schema 验证所选本轮文件基线。模型只能传要求与基线 ID，不能传路径、Schema 或通过结论。rejected 表示实际校验不符合，工具成功不代表通过；只有当前字节匹配的 passed 可满足 Workflow 出口。',inputSchema:zodToJsonSchema(validationInputSchema),outputSchema:zodToJsonSchema(validationOutputSchema),cancellation:{mode:'preflight_only',description:'读取与保存前检查停止；保存之后取消不删除已有检查事实，不承诺回滚。'},recovery:{mode:'inspect_before_retry',queryTool:'cbim_task_inspect',description:'先核实本轮原验证记录和基线，不自动重做已保存检查。'}}]}
  /** 返回坏正文仍保留原检查事件；唯一 wire 核实之前不 parse 端口结果或重编码。 */
  async call(name:string,input:unknown,toolCallId?:string){
    if(name!==validationToolName||!toolCallId||toolCallId.length>128||toolCallId.trim()!==toolCallId||/[\x00-\x1f]/.test(toolCallId))throw Error('验证必须由本轮真实调用发起');
    const args=validationInputSchema.parse(input),expected=structuredClone(args),selected=validationRequirement(this.bindings,expected.moduleId,expected.requirementId),result=await this.port.run(args,toolCallId);
    return checkedJsonToolResult(name,{state:'checked',validation:result},validationOutputSchema.superRefine((value,ctx)=>{
      const v=value.validation;if(!same(v.binding,this.binding)||v.knowledgeRevision!==this.knowledgeRevision||v.toolCallId!==toolCallId||v.requirement.moduleId!==expected.moduleId||v.requirement.requirementId!==expected.requirementId||v.requirement.workflowId!==selected.binding.workflowId||v.requirement.workflowVersion!==selected.binding.workflowVersion||v.requirement.schemaHash!==selected.schemaHash||v.artifact.relativePath!==selected.requirement.artifactPath||v.baselineId!==expected.baselineId||v.taskProgressVersion!==expected.expectedTaskProgressVersion)ctx.addIssue({code:'custom',message:'验证输出与本轮绑定或原请求不一致'});
    }));
  }
}
