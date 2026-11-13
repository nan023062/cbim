/**
 * 作用定位：调度引擎：将明确选择的模块、叶子 Agent 和本模块 Workflow 装配为执行任务。
 * 设计原因：通过本层只读查询编排和 Core 契约准备版本一致的 Skill 与 Workflow；旧单模块入口及续聊遇程序约定明确拒绝，避免绕过正式成员门禁。无约定旧任务保留计划与证据行为，知识正文不赋予无限改写权。
 * 旧 responsiblePerson 仅作历史说明，不查询花名册、不承担授权或派发门禁。
 * 读取边界：领域查询只收到 snapshot 端口，准备任务不借查询对象写入或刷新知识。
 */
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {KnowledgeQueries} from '../../../logic/knowledge/rules/knowledge-queries';
import {Builtins} from '../../../logic/knowledge/rules/builtins';
import {fail} from '../../../core/errors';
import type {KnowledgeWorkspace} from '../../../logic/knowledge/rules/ports';
import type {TaskSpec} from '../../../logic/execution/rules';
import {parseWorkflowContract} from '../../../logic/workspace/rules/workflow-contract';

export const teamTaskInput=z.object({goal:z.string().trim().min(1),moduleId:z.string().min(1),agentId:z.string().min(1),workflowId:z.string().min(1),responsiblePerson:z.string().optional(),acceptance:z.array(z.string().trim().min(1)).min(1)});
export type TeamTaskInput=z.infer<typeof teamTaskInput>;
/** 历史单任务续聊也不能绕过正式成员门禁；只检查其原冻结正文，不读取新知识补造约定。 */
export function assertLegacyWorkflowCompatible(task:TaskSpec):void{
  const workflow=task.workflowContext?.workflow as {content?:{text?:unknown}}|undefined;
  if(typeof workflow?.content?.text==='string'&&parseWorkflowContract(workflow.content.text))fail('WORKFLOW_MEMBER_REQUIRED','声明了程序执行约定的 Workflow 必须通过主调度派发正式成员；旧单任务及其续聊入口不提供该门禁');
}
/** 只读准备；所有正文必须来自同一知识版本，缺失和继承冲突拒绝启动。 */
export async function prepareTeamTask(workspace:KnowledgeWorkspace,input:TeamTaskInput):Promise<TaskSpec>{
  const selection=teamTaskInput.parse(input),queries=new KnowledgeQueries({snapshot:()=>workspace.snapshot()});
  const module=await queries.module(selection.moduleId),agent=await queries.agent(selection.agentId);
  if(!module.structural||!agent.structural)fail('VALIDATION','知识结构存在错误，请先完成知识治理');
  if(!agent.skillSelectionValid)fail('SKILL_CONFLICT','Agent 可用 Skill 存在继承冲突');
  if(!agent.principles.available||!module.overview.available||agent.skills.some(s=>!s.content.available))fail('MISSING_CONTENT','模块知识、Agent 原则或 Skill 正文缺失');
  const workflow=module.workflows.find((w:any)=>w.id===selection.workflowId);
  if(!workflow||!workflow.content.available)fail('WORKFLOW_SCOPE','只能选择当前模块登记且正文可用的 Workflow');
  if(parseWorkflowContract(workflow.content.text))fail('WORKFLOW_MEMBER_REQUIRED','声明了程序执行约定的 Workflow 必须通过主调度派发正式成员；旧单任务入口不提供该门禁');
  const current=await workspace.read();
  if([agent.revision,current.revision].some(r=>r!==module.revision))fail('CONFLICT','任务准备期间知识变化，请重新准备');
  const builtins=new Builtins(workspace.rules.designRoot);
  const standards=await Promise.all(['business-execution','common-rules'].map(id=>builtins.read(id)));
  return {taskId:randomUUID(),workspaceId:workspace.entry.id,root:workspace.entry.path,goal:selection.goal,moduleIds:[module.id],agentId:agent.id,responsiblePerson:selection.responsiblePerson,acceptance:selection.acceptance,
    workflowContext:{revision:module.revision,workflowId:workflow.id,module,agent,workflow,standards}};
}

/** 正文是业务上下文，不授予工具权限；实际工具由本次运行注册并受统一策略约束。 */
export const loopInstructions=`你是 CBIM Team 中有自身会话、状态和模型思考能力的执行 Agent。
主 Agent 可直接实现与验证未配置自定义 Agent 的模块，背后由任务调度引擎管理自定义岗位派工，也可经受控知识服务治理团队与业务架构。你本轮是独立自定义执行角色，只完成派给自己的任务，不再次派工。
全部知识查询和增删改查必须使用本次注册的 cbim_ 内部工具，禁止直接读写 .cbim/。知识修改须在本任务范围与当前 read/ask/execute 权限内，通过审批、版本核验及事务；范围外的团队或业务架构调整报告给主 Agent。
任务上下文提供已核实的模块、Agent 原则、祖先与自身 Skill、选定的本模块 Workflow，以及内置规范正文。
主动探索真实 Team 环境与目标模块，结合 Agent 原则和有效 Skill，按选定 Workflow 自主判断、执行和验证；不继承其他模块流程，不扩大模块范围或工具权限。知识里的分工建议不能覆盖本轮执行者职责。
超出目标模块或需要其他成员协作时，把事实、所需能力和限制报告给主调度 Agent；未提供成员间派发、等待或通信工具时，不声称已启动、联系或等待其他成员。
空闲、工作、等待和沟通状态由可靠调度与运行/工具事件维护，不通过正文自称改变状态或伪造回执。
先核实目标、步骤、责任与验收要求；缺失能力先查工具清单，记录缺口并继续可用流程。
使用 cbim_task_plan 持久化执行计划，用 cbim_task_step 关联 cbim_task_inspect 返回的有效回执；发生目标或范围调整必须记录修订原因。通过 cbim_delivery_prepare 准备交付候选，不自行判定人工验收。
工具结果是执行证据；最终报告成果、验证证据、未完成项和治理待办，不将模型结束等同于验收通过。`;
