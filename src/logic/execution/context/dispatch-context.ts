/**
 * 作用定位：解析主会话内置身份，以及正式派发所需的角色知识与多模块绑定。
 * 设计原因：诊断主实例不依赖业务知识完好；正式派发严格解析执行角色与各模块 Workflow，主会话不能冒充独立成员。两种协作模式的直接业务均由主会话运行策略处理，不走此成员解析入口。
 * 职责边界：只读并冻结输入，不创建实例、不派发消息、不读取历史真人花名册或维护声明，执行资格由岗位责任与运行授权核实。
 * 读取边界：角色、模块与正文读取只经 knowledge/read-models 公开入口，成员派发的身份和授权仍在本层核实。
 */
import {fail} from '../../../core/errors';
import {hash} from '../../../core/platform/node/serialization';
import {content,Team,BusinessWorkspace} from '../../knowledge/rules/read-models';
import type {Snapshot} from '../../knowledge/rules/types';

import type {AgentConfigurationSnapshot} from '../../team/rules/agent-types';
import type {ModuleBinding} from '../../tasks/rules/graph-types';
import {validateWorkflowSelections,type WorkflowSelection} from '../../tasks/rules/workflow-selection';

import {mainAgentId,mainAgentInstructions} from '../../conversation/runtime/main-agent';

/** 派发只使用结构完整的固定版本；普通问答仍可通过原查询入口查看缺口。 */
function assertSnapshot(snapshot:Snapshot){
  if(!snapshot.workspaceId||!snapshot.revision||!snapshot.validation?.structural)fail('KNOWLEDGE_INVALID','派发需要通过结构校验的知识快照，请先处理知识问题');
}

/** 将知识服务的可用正文转换为固定内容；缺正文不能悄悄变成空专业规则。 */
function textOf(body:ReturnType<typeof content>):string{
  if(!body.available||!('text' in body)||typeof body.text!=='string')fail('KNOWLEDGE_INVALID','派发所需的知识正文不可用');
  return body.text;
}

/** 仅用于建图和普通对话身份登记；知识异常也允许诊断，但不声称已加载可执行 Skill。正式任务必须走 resolveDispatchAgent。 */
export function resolveConversationAgent(snapshot:Snapshot):AgentConfigurationSnapshot{
  if(!snapshot.workspaceId||!snapshot.revision)fail('KNOWLEDGE_INVALID','主会话身份登记需要有效工作区和知识版本');
  return {workspaceId:snapshot.workspaceId,teamId:'.cbim/team',agentId:mainAgentId,knowledgeRevision:snapshot.revision,name:'CBIM 主 Agent',source:'builtin',principles:mainAgentInstructions,effectiveSkills:[]};
}

/** 仅解析独立派发的自定义角色；主 Agent 在原会话执行，退役角色仅保留历史身份。 */
export async function resolveDispatchAgent(snapshot:Snapshot,agentId:string):Promise<AgentConfigurationSnapshot>{
  assertSnapshot(snapshot);
  if(typeof agentId!=='string'||!agentId.trim())fail('AGENT_MISSING','请指定已登记的成员角色');
  const identity={workspaceId:snapshot.workspaceId,teamId:'.cbim/team',agentId,knowledgeRevision:snapshot.revision};
  if(agentId===mainAgentId)fail('AGENT_ROLE_INVALID','主 Agent 请在当前会话直接执行，不创建独立成员任务');
  if(agentId==='cbim:executor')fail('AGENT_RETIRED','内置默认执行 Agent 已退役；未指定自定义 Agent 的模块由主 Agent 在当前会话执行');
  if(!Object.hasOwn(snapshot.validation!.skills??{},agentId))fail('AGENT_MISSING','成员角色不存在或不是有效团队叶子');
  const agent=await new Team(snapshot).agent(agentId);
  if(!agent.skillSelectionValid)fail('KNOWLEDGE_INVALID','成员 Skill 继承存在冲突');
  return {...identity,name:agent.definition.name,source:'workspace',principles:textOf(agent.principles),
    effectiveSkills:agent.skills.map(skill=>({skillId:skill.id,ownerId:skill.owner,inherited:skill.inherited,content:textOf(skill.content)}))};
}

/**
 * 解析至少一个真实模块，核实本模块实际挂载的 Workflow；岗位及负责人由派发入口独立核实。
 * 显式选择只按逻辑 ID 查本模块清单；未选择的模块沿用首项或空清单 general，不回退失效选择、不继承父模块。
 */
export async function resolveDispatchModules(snapshot:Snapshot,moduleIds:string[],workflowSelections?:readonly WorkflowSelection[]):Promise<ModuleBinding[]>{
  assertSnapshot(snapshot);
  if(!Array.isArray(moduleIds)||!moduleIds.length||moduleIds.length>100||moduleIds.some(id=>typeof id!=='string'||!id.trim())||new Set(moduleIds).size!==moduleIds.length)fail('MODULE_MISSING','任务需要 1–100 个不重复的真实模块 ID');
  validateWorkflowSelections(moduleIds,workflowSelections);
  const workspace=new BusinessWorkspace(snapshot),bindings:ModuleBinding[]=[];
  for(const moduleId of moduleIds){
    if(!Object.hasOwn(snapshot.validation!.tree.nodes,moduleId))fail('MODULE_MISSING',`模块不存在：${moduleId}`);
    const module=await workspace.module(moduleId);
    const selected=workflowSelections?.find(item=>item.moduleId===moduleId);
    const workflow=selected?module.workflows.find((item:{id:string})=>item.id===selected.workflowId):module.workflows[0];
    if(selected&&!workflow)fail('WORKFLOW_SELECTION_INVALID','选定的 Workflow 未挂载于对应模块，请查询当前模块后重新规划');
    bindings.push({moduleId,name:module.definition.name,knowledgeRevision:snapshot.revision,
      workflow:workflow?{kind:'module',id:workflow.id,version:hash(textOf(workflow.content))}
        :{kind:'general',id:'cbim:general',version:'1',reason:'本模块未挂载专属 Workflow，采用 CBIM 通用任务流程'},
    });
  }
  return bindings;
}
