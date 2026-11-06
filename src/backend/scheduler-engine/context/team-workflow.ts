/**
 * 作用定位：调度引擎：将明确选择的模块、叶子 Agent 和本模块 Workflow 装配为执行任务。
 * 设计原因：只通过 Core 契约准备版本一致的 Skill 与 Workflow，保存正文供追溯，不依赖 main。
 */
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {KnowledgeQueries} from '../../core/knowledge/knowledge-queries';
import {Builtins} from '../../core/knowledge/builtins';
import {fail} from '../../core/foundation/errors';
import type {KnowledgeWorkspace} from '../../core/knowledge/ports';
import type {TaskSpec} from '../../core/brain';

export const teamTaskInput=z.object({goal:z.string().trim().min(1),moduleId:z.string().min(1),agentId:z.string().min(1),workflowId:z.string().min(1),responsiblePerson:z.string().optional(),acceptance:z.array(z.string().trim().min(1)).min(1)});
export type TeamTaskInput=z.infer<typeof teamTaskInput>;
/** 只读准备；所有正文必须来自同一知识版本，缺失和继承冲突拒绝启动。 */
export async function prepareTeamTask(workspace:KnowledgeWorkspace,input:TeamTaskInput):Promise<TaskSpec>{
  const selection=teamTaskInput.parse(input),queries=new KnowledgeQueries(workspace);
  const module=await queries.module(selection.moduleId),agent=await queries.agent(selection.agentId);
  if(!module.structural||!agent.structural)fail('VALIDATION','知识结构存在错误，请先完成知识治理');
  if(!agent.skillSelectionValid)fail('SKILL_CONFLICT','Agent 可用 Skill 存在继承冲突');
  if(!agent.principles.available||!module.overview.available||agent.skills.some(s=>!s.content.available))fail('MISSING_CONTENT','模块知识、Agent 原则或 Skill 正文缺失');
  const workflow=module.workflows.find((w:any)=>w.id===selection.workflowId);
  if(!workflow||!workflow.content.available)fail('WORKFLOW_SCOPE','只能选择当前模块登记且正文可用的 Workflow');
  const people=await queries.people();
  if(selection.responsiblePerson&&!people.people.some((p:any)=>p.id===selection.responsiblePerson))fail('PERSON_NOT_FOUND','责任人不在真人花名册中');
  const current=await workspace.read();
  if([agent.revision,people.revision,current.revision].some(r=>r!==module.revision))fail('CONFLICT','任务准备期间知识变化，请重新准备');
  const builtins=new Builtins(workspace.rules.designRoot);
  const standards=await Promise.all(['business-execution','common-rules'].map(id=>builtins.read(id)));
  return {taskId:randomUUID(),workspaceId:workspace.entry.id,root:workspace.entry.path,goal:selection.goal,moduleIds:[module.id],agentId:agent.id,responsiblePerson:selection.responsiblePerson,acceptance:selection.acceptance,
    workflowContext:{revision:module.revision,workflowId:workflow.id,module,agent,workflow,standards}};
}

/** 正文是业务上下文，不授予工具权限；历史资料中的 MCP 表述映射到相同内部工具。 */
export const loopInstructions=`你是 CBIM 内部团队工作流执行器。
全部知识查询和增删改查必须使用本次注册的 cbim_ 内部工具，禁止直接读写 .cbim/。
内置规范中的 MCP 或宿主表述，在本运行中指同名的 CBIM 内部工具，不需要安装或连接外部 MCP。
任务上下文提供已核实的模块、Agent 原则、祖先与自身 Skill、选定的本模块 Workflow，以及内置规范正文。
按选定 Workflow 开展工作，遵守 Agent 原则和有效 Skill；不继承其他模块流程，不扩大权限。
先核实目标、步骤、责任与验收要求；缺失能力先查工具清单，记录缺口并继续可用流程。
工具结果是执行证据；最终报告成果、验证证据、未完成项和治理待办，不将模型结束等同于验收通过。`;
