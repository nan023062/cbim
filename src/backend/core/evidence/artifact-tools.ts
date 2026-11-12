/**
 * 目录归属：backend/core/evidence；产物与 Workflow 证据规则。
 * 作用定位：正式成员的显式文件基线工具包装，校验模型输入并委托本轮可信采集端口。
 * 设计原因：参数中没有路径、哈希或运行身份；真实采集由运行时负责，返回值只按唯一 JSON 正文核实绑定与原请求，避免解析修复或自动重采。
 */
import {zodToJsonSchema} from 'zod-to-json-schema';
import {checkedJsonToolResult} from '../tools/results';
import {artifactCaptureInputSchema,type ArtifactCaptureInput,type ArtifactBaselineStaged} from './artifact-baseline';
import {memberToolContract,memberToolOutputSchema,type MemberToolOutputBinding} from '../tasks/member-tool-output';
export const artifactCaptureToolName='cbim_task_artifact_capture';
/** 分类为记录维护，不改变权限；名称受任务证据排除规则保护，哈希不能代替业务验证。 */
export function artifactTool(name:string,input:unknown){return name===artifactCaptureToolName?{args:artifactCaptureInputSchema.parse(input),effects:['maintenance'] as const,native:false}:undefined}
export class ArtifactTools {
  private readonly knowledgeRevision?:string;
  /** binding 来自真实成员装配；可选知识版本同样在构造时冻结，均不能由模型参数补充。 */
  constructor(private readonly binding:MemberToolOutputBinding,private readonly ports:{knowledgeRevision?:string;capture(input:ArtifactCaptureInput,toolCallId:string):Promise<ArtifactBaselineStaged>}){this.binding=Object.freeze(structuredClone(binding));this.knowledgeRevision=ports.knowledgeRevision}
  async list(){return [{name:artifactCaptureToolName,description:'显式采集已完成 read/write/edit 单文件调用所涉及文件的当前指纹。只传当前任务进度版本与本轮真实成功调用 ID，不能填写路径或哈希；采集时不可有其它在途工具。指纹仅证明采集时所列文件的字节，不证明较早测试针对这些字节，不代表整个工作区未变、业务验收或恢复许可。',inputSchema:zodToJsonSchema(artifactCaptureInputSchema) as Record<string,unknown>,...memberToolContract(artifactCaptureToolName)}];}
  /** 保存后坏正文保留原事件并失败，不自动补采；短门闩仍由运行时真实结束事件释放。 */
  async call(name:string,input:unknown,toolCallId?:string){
    if(name!==artifactCaptureToolName||!toolCallId||toolCallId.length>128||toolCallId.trim()!==toolCallId||/[\x00-\x1f]/.test(toolCallId))throw Error('文件基线必须由当前成员的真实工具调用提交');
    const args=artifactCaptureInputSchema.parse(input),expectedInput=structuredClone(args);
    const baseline=await this.ports.capture(args,toolCallId);
    return checkedJsonToolResult(name,{state:'captured',baseline},memberToolOutputSchema(artifactCaptureToolName,{binding:this.binding,input:expectedInput,toolCallId,knowledgeRevision:this.knowledgeRevision}));
  }
}
