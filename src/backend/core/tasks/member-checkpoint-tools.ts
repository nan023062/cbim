/**
 * 作用定位：包装正式执行成员的检查点工具，限制模型输入并将真实调用 ID 交给运行时。
 * 设计原因：门闩、停止、文件复核和 canonical 暂存由同一运行拥有，工具层不自行签发完成或恢复事实。
 */
import {zodToJsonSchema} from 'zod-to-json-schema';
import {jsonToolResult} from '../tools/results';
import {memberCheckpointInputSchema,memberCheckpointStagedSchema,type MemberCheckpointInput,type MemberCheckpointStaged} from './member-checkpoint';
export const memberCheckpointToolName='cbim_task_checkpoint';
/** 记录维护不提升原任务权限，名称受业务证据排除规则保护。 */
export function memberCheckpointTool(name:string,input:unknown){return name===memberCheckpointToolName?{args:memberCheckpointInputSchema.parse(input),effects:['maintenance'] as const,native:false}:undefined}
export class MemberCheckpointTools{
  constructor(private readonly ports:{stage(input:MemberCheckpointInput,toolCallId:string):Promise<MemberCheckpointStaged>}){}
  async list(){return [{name:memberCheckpointToolName,description:'申请本任务的一次安全检查点。只支持成功 read/write/edit 涉及的全部有界文件均由所选最新基线覆盖；不支持命令、目录扫描、未知或失败操作。调用后立即结束本轮，不能再使用工具；主调度核实正常关闭后决定是否预约同任务一次续执行。本请求不是交付或已恢复。',inputSchema:zodToJsonSchema(memberCheckpointInputSchema) as Record<string,unknown>}];}
  /** 只返回暂存正文；可信结束事件与最终结算仍由运行时、调度器完成。 */
  async call(name:string,input:unknown,toolCallId?:string){
    if(name!==memberCheckpointToolName||!toolCallId||!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(toolCallId))throw Error('检查点必须来自当前成员的真实一次性调用');
    const args=memberCheckpointInputSchema.parse(input),checkpoint=memberCheckpointStagedSchema.parse(await this.ports.stage(args,toolCallId));
    if(checkpoint.toolCallId!==toolCallId||JSON.stringify(checkpoint.input)!==JSON.stringify(args))throw Error('检查点返回值与当前请求不一致');
    return jsonToolResult(name,{state:'staged',checkpoint});
  }
}
