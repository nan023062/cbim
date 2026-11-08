/**
 * 作用定位：为已装配 JSON/CSV 验证要求的正式成员提供严格输入、唯一 wire 输出及真实能力说明。
 * 设计原因：模型只选择已有要求与产物身份；完整模式在调用前固定可信范围/内容摘要，坏回包不重试，也不把 rejected 修复成通过。
 */
import {zodToJsonSchema} from 'zod-to-json-schema';
import {checkedJsonToolResult} from '../tools/results';
import {validationInputSchema,validationOutputSchema,validationToolName,type ValidationBinding,type ValidationInput,type ValidationResult} from './validation';
import {validationRequirement,type ValidationWorkflowBinding} from './validation-evidence';
import {completeOutputRequired} from './complete-output-evidence';
import type {OutputManifestIdentity} from './output-manifest';
import {isDeepStrictEqual} from 'node:util';
const same=(a:ValidationBinding,b:ValidationBinding)=>Object.keys(a).length===Object.keys(b).length&&Object.entries(a).every(([key,value])=>b[key as keyof ValidationBinding]===value);
export {validationToolName} from './validation';
/** 真实只读文件操作，作用域仍由运行时注入；Schema 与路径不在模型参数中。 */
export function validationTool(name:string,input:unknown){return name===validationToolName?{args:validationInputSchema.parse(input),effects:['read'] as const,native:false}:undefined}
export class ValidationTools {
  private readonly knowledgeRevision:string;
  private readonly bindings:readonly ValidationWorkflowBinding[];
  constructor(private readonly binding:ValidationBinding,private readonly port:{knowledgeRevision:string;bindings:readonly ValidationWorkflowBinding[];manifestIdentity?(input:ValidationInput):OutputManifestIdentity|undefined;run(input:ValidationInput,toolCallId:string):Promise<ValidationResult>}){this.binding=Object.freeze(structuredClone(binding));this.knowledgeRevision=port.knowledgeRevision;this.bindings=structuredClone(port.bindings)}
  async list(){return [{name:validationToolName,version:1,effects:['read'] as const,description:'按当前模块冻结的验证器检查 JSON 结构或 CSV 表格。CSV明确核对表头、字段类型/约束、行数和唯一键，不执行公式。完整交付模式必须明确 manifestId 并复核整个声明集合；旧模式明确 baselineId，两者互斥。模型不能传路径、Schema 或通过结论。rejected 表示实际校验不符合，工具成功不代表通过；只有当前字节匹配的 passed 可满足 Workflow 出口。',inputSchema:zodToJsonSchema(validationInputSchema),outputSchema:zodToJsonSchema(validationOutputSchema),cancellation:{mode:'preflight_only',description:'读取与保存前检查停止；保存之后取消不删除已有检查事实，不承诺回滚。'},recovery:{mode:'inspect_before_retry',queryTool:'cbim_task_inspect',description:'先核实本轮原验证记录和产物身份，不自动重做已保存检查。'}}]}
  /** 返回坏正文仍保留原检查事件；唯一 wire 核实之前不 parse 端口结果或重编码。 */
  async call(name:string,input:unknown,toolCallId?:string){
    if(name!==validationToolName||!toolCallId||toolCallId.length>128||toolCallId.trim()!==toolCallId||/[\x00-\x1f]/.test(toolCallId))throw Error('验证必须由本轮真实调用发起');
    const args=validationInputSchema.parse(input),expected=structuredClone(args),selected=validationRequirement(this.bindings,expected.moduleId,expected.requirementId);
    if(completeOutputRequired(this.bindings)!==!!expected.manifestId)throw Error('验证产物依据与本轮完整出口声明不一致');
    const manifest=expected.manifestId?structuredClone(this.port.manifestIdentity?.(expected)):undefined;
    if(expected.manifestId&&(!manifest||manifest.manifestId!==expected.manifestId))throw Error('验证缺少可信原完整清单身份');
    const result=await this.port.run(args,toolCallId);
    return checkedJsonToolResult(name,{state:'checked',validation:result},validationOutputSchema.superRefine((value,ctx)=>{
      if(!isDeepStrictEqual(value.validation.manifest,manifest))ctx.addIssue({code:'custom',message:'验证输出更换了原完整清单范围或内容指纹'});
      const v=value.validation;if(v.validator!==selected.requirement.validator||!same(v.binding,this.binding)||v.knowledgeRevision!==this.knowledgeRevision||v.toolCallId!==toolCallId||v.requirement.moduleId!==expected.moduleId||v.requirement.requirementId!==expected.requirementId||v.requirement.workflowId!==selected.binding.workflowId||v.requirement.workflowVersion!==selected.binding.workflowVersion||v.requirement.schemaHash!==selected.schemaHash||v.artifact.relativePath!==selected.requirement.artifactPath||v.baselineId!==expected.baselineId||v.manifest?.manifestId!==expected.manifestId||v.taskProgressVersion!==expected.expectedTaskProgressVersion)ctx.addIssue({code:'custom',message:'验证输出与本轮绑定、验证器或原请求不一致'});
    }));
  }
}
