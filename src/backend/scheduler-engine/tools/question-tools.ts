/**
 * 作用定位：为已装配用户交互端口的主/成员运行提供结构化提问工具及严格答案回包。
 * 设计原因：等待前独立冻结原题，领域端口只调用一次；输出按唯一 JSON wire 核验，不因答案已消费后的坏回包重新提问。
 * 职责边界：保留答案或取消事实，不从用户文字授予工具权限、认证身份或业务验收，也不加入知识工具目录。
 */
import {zodToJsonSchema} from 'zod-to-json-schema';
import {questionInput,questionResultSchema,questionResultForInput,questionToolName,type QuestionInput} from '../../core/tools/questions';
import {checkedJsonToolResult} from '../../core/tools/results';
import type {ToolCancellation,ToolRecovery} from '../../core/tools/contracts';
import type {RunToolDescriptor} from '../../core/tools/policy/tool-policy';
import {fail} from '../../core/foundation/errors';

/** 仅描述现有交互；等待可取消，已消费的答案及既有运行记录不会回滚。 */
export const questionTool={
  name:questionToolName,version:1,effects:['read'] as const,
  description:'需要用户在方案、方向或偏好之间选择时使用。提供2至6个选项，界面自动提供其它补充输入。等待答复后继续，不要仅在正文列出选项。回答或取消只表示交互事实，不授予执行权限，不是业务完成或人工验收证据；回包异常先核实已有记录，不自动重问。',
  inputSchema:zodToJsonSchema(questionInput) as Record<string,unknown>,outputSchema:zodToJsonSchema(questionResultSchema) as Record<string,unknown>,
  cancellation:{mode:'during_wait',description:'停止、关闭或调用取消会结束尚未完成的等待；回答与取消先发生者生效，已消费答案不回滚。'} satisfies ToolCancellation,
  recovery:{mode:'inspect_before_retry',description:'先核实原会话的问题与工具记录。输出失败可能发生在用户回答已消费之后，不自动重新弹题；重启不恢复旧等待。'} satisfies ToolRecovery,
};

/** 只有真实 requestQuestion 端口才注册；主/成员的任务归属继续由各自队列闭包及 canonical 调用身份绑定。 */
export class QuestionTools {
  constructor(private readonly request:(input:QuestionInput,signal:AbortSignal)=>Promise<unknown>){}
  has(name:string){return name===questionToolName}
  list(){return [structuredClone(questionTool)]}
  private parse(name:string,raw:unknown){
    if(!this.has(name))fail('QUESTION_TOOL_UNKNOWN','当前运行没有该提问工具');
    const parsed=questionInput.safeParse(raw);if(!parsed.success)fail('QUESTION_INPUT_INVALID','问题参数无效，请提供1至3个问题及各2至6个选项，不接受身份或授权字段');return parsed.data;
  }
  /** 授权前只检查严格原参数并分类，不弹题、不消费回答。 */
  describe(name:string,raw:unknown):RunToolDescriptor{this.parse(name,raw);return {effects:['read'],native:false}}
  /** 不在 await 后用取消覆盖先完成的回答；真正终态由队列的一次消费边界决定。 */
  async call(name:string,raw:unknown,signal:AbortSignal){
    const input=this.parse(name,raw),schema=questionResultForInput(input);
    const result=await this.request(input,signal);
    return checkedJsonToolResult(name,result,schema);
  }
}
