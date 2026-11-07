/**
 * 作用定位：正式成员的显式文件基线工具包装，校验模型输入并委托本轮可信采集端口。
 * 设计原因：参数中没有路径、哈希或运行身份；并发门闩、来源核实、真实文件读取和事件落盘统一由运行时负责，避免工具自证交付。
 */
import {zodToJsonSchema} from 'zod-to-json-schema';
import {jsonToolResult} from '../tools/results';
import {artifactCaptureInputSchema,artifactBaselineStagedSchema,type ArtifactCaptureInput,type ArtifactBaselineStaged} from './artifact-baseline';
export const artifactCaptureToolName='cbim_task_artifact_capture';
/** 分类为记录维护，不改变权限；名称受任务证据排除规则保护，哈希不能代替业务验证。 */
export function artifactTool(name:string,input:unknown){return name===artifactCaptureToolName?{args:artifactCaptureInputSchema.parse(input),effects:['maintenance'] as const,native:false}:undefined}
export class ArtifactTools {
  constructor(private readonly ports:{capture(input:ArtifactCaptureInput,toolCallId:string):Promise<ArtifactBaselineStaged>}){}
  async list(){return [{name:artifactCaptureToolName,description:'显式采集已完成 read/write/edit 单文件调用所涉及文件的当前指纹。只传当前任务进度版本与本轮真实成功调用 ID，不能填写路径或哈希；采集时不可有其它在途工具。指纹仅证明采集时所列文件的字节，不证明较早测试针对这些字节，不代表整个工作区未变、业务验收或恢复许可。',inputSchema:zodToJsonSchema(artifactCaptureInputSchema) as Record<string,unknown>}];}
  /** 必须传真实桥调用 ID；端口保存暂存事件，统一运行时随后签发工具结束回执。 */
  async call(name:string,input:unknown,toolCallId?:string){
    if(name!==artifactCaptureToolName||!toolCallId||toolCallId.length>128||toolCallId.trim()!==toolCallId||/[\x00-\x1f]/.test(toolCallId))throw Error('文件基线必须由当前成员的真实工具调用提交');
    const args=artifactCaptureInputSchema.parse(input),baseline=artifactBaselineStagedSchema.parse(await this.ports.capture(args,toolCallId));
    if(baseline.captureToolCallId!==toolCallId||baseline.progressVersion!==args.expectedTaskProgressVersion||baseline.sourceCalls.length!==args.sourceToolCallIds.length||args.sourceToolCallIds.some(id=>!baseline.sourceCalls.some(call=>call.toolCallId===id)))throw Error('文件基线返回值与已授权采集请求不一致');
    return jsonToolResult(name,{state:'captured',baseline});
  }
}
