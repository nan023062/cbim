/**
 * 作用定位：包装正式执行成员的检查点工具，限制模型输入并将真实调用 ID 交给运行时。
 * 设计原因：门闩、停止、文件复核和 canonical 暂存由同一运行拥有；工具仅在唯一 JSON 正文核验可信绑定，不修复坏返回值或自行签发恢复事实。
 */
import {zodToJsonSchema} from 'zod-to-json-schema';
import {checkedJsonToolResult} from '../../tools/rules/results';
import {memberCheckpointInputSchema,type MemberCheckpointInput,type MemberCheckpointStaged} from './member-checkpoint';
import {memberToolContract,memberToolOutputSchema,type MemberToolOutputBinding} from './member-tool-output';
export const memberCheckpointToolName='cbim_task_checkpoint';
/** 记录维护不提升原任务权限，名称受业务证据排除规则保护。 */
export function memberCheckpointTool(name:string,input:unknown){return name===memberCheckpointToolName?{args:memberCheckpointInputSchema.parse(input),effects:['maintenance'] as const,native:false}:undefined}
export class MemberCheckpointTools{
  private readonly knowledgeRevision?:string;
  /** 每个实例冻结完整成员身份；当前知识由运行时另行实时复核，输出不得借端口返回值改绑。 */
  constructor(private readonly binding:MemberToolOutputBinding,private readonly ports:{knowledgeRevision?:string;stage(input:MemberCheckpointInput,toolCallId:string):Promise<MemberCheckpointStaged>}){this.binding=Object.freeze(structuredClone(binding));this.knowledgeRevision=ports.knowledgeRevision}
  async list(){return [{name:memberCheckpointToolName,description:'申请本运行的一次安全检查点（每任务最多16段）。只支持成功 read/write/edit 涉及的全部有界文件均由所选最新基线覆盖；不支持命令、目录扫描、未知或失败操作。调用后立即结束本轮，不能再使用工具；主调度核实正常关闭后决定是否预约最新段的一次续执行。本请求不是交付或已恢复。',inputSchema:zodToJsonSchema(memberCheckpointInputSchema) as Record<string,unknown>,...memberToolContract(memberCheckpointToolName)}];}
  /** 输出错误不撤销暂存或解锁；成功正文仍仅是请求，可信结束与最终结算在运行时、调度器。 */
  async call(name:string,input:unknown,toolCallId?:string){
    if(name!==memberCheckpointToolName||!toolCallId||!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(toolCallId))throw Error('检查点必须来自当前成员的真实一次性调用');
    const args=memberCheckpointInputSchema.parse(input),expectedInput=structuredClone(args);
    const checkpoint=await this.ports.stage(args,toolCallId);
    return checkedJsonToolResult(name,{state:'staged',checkpoint},memberToolOutputSchema(memberCheckpointToolName,{binding:this.binding,input:expectedInput,toolCallId,knowledgeRevision:this.knowledgeRevision}));
  }
}
