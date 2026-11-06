/**
 * 作用定位：从同一知识快照解析派发角色与多模块绑定，供成员注册和任务入队使用。
 * 设计原因：模型只提供候选 ID；角色、继承 Skill、维护人和 Workflow 均从已校验知识取得，不接受伪造的完整绑定。
 * 职责边界：只读并冻结输入，不创建实例、不派发消息、不把本机维护声明当作权限批准。
 */
import path from 'node:path';
import {fail} from '../../core/foundation/errors';
import {hash} from '../../core/foundation/serialization';
import {content,data} from '../../core/knowledge/snapshot';
import type {Snapshot} from '../../core/knowledge/types';
import {Team} from '../../core/team/model';
import type {AgentConfigurationSnapshot} from '../../core/team/agent-types';
import type {ModuleBinding} from '../../core/tasks/graph-types';
import type {ModuleMaintenanceDefinition} from '../../core/workspace/maintenance';
import {BusinessWorkspace} from '../../core/workspace/model';
import {mainAgentId,mainAgentInstructions} from '../conversation/main-agent';

/** 派发只使用结构完整的固定版本；普通问答仍可通过原查询入口查看缺口。 */
function assertSnapshot(snapshot:Snapshot){
  if(!snapshot.workspaceId||!snapshot.revision||!snapshot.validation?.structural)fail('KNOWLEDGE_INVALID','派发需要通过结构校验的知识快照，请先处理知识问题');
}

/** 将知识服务的可用正文转换为固定内容；缺正文不能悄悄变成空专业规则。 */
function textOf(body:ReturnType<typeof content>):string{
  if(!body.available||!('text' in body)||typeof body.text!=='string')fail('KNOWLEDGE_INVALID','派发所需的知识正文不可用');
  return body.text;
}

/** 统一解析内置主角色与真实团队叶子角色；返回配置正文，不创建运行身份或授予工具权限。 */
export async function resolveDispatchAgent(snapshot:Snapshot,agentId:string):Promise<AgentConfigurationSnapshot>{
  assertSnapshot(snapshot);
  if(typeof agentId!=='string'||!agentId.trim())fail('AGENT_MISSING','请指定已登记的成员角色');
  const identity={workspaceId:snapshot.workspaceId,teamId:'.cbim/team',agentId,knowledgeRevision:snapshot.revision};
  if(agentId===mainAgentId){
    const ownerId='.cbim/team',definition=data(snapshot,ownerId+'/skills.json');
    return {...identity,name:'CBIM 主 Agent',source:'builtin',principles:mainAgentInstructions,
      effectiveSkills:definition.skills.map((skill:{reference:string})=>({
        skillId:path.posix.dirname(path.posix.join(ownerId,skill.reference)),ownerId,inherited:true,
        content:textOf(content(snapshot,ownerId,skill.reference)),
      }))};
  }
  if(!Object.hasOwn(snapshot.validation!.skills??{},agentId))fail('AGENT_MISSING','成员角色不存在或不是有效团队叶子');
  const agent=await new Team(snapshot).agent(agentId);
  if(!agent.skillSelectionValid)fail('KNOWLEDGE_INVALID','成员 Skill 继承存在冲突');
  return {...identity,name:agent.definition.name,source:'workspace',principles:textOf(agent.principles),
    effectiveSkills:agent.skills.map(skill=>({skillId:skill.id,ownerId:skill.owner,inherited:skill.inherited,content:textOf(skill.content)}))};
}

/**
 * 解析至少一个真实模块，核实显式维护关系并固定该模块自己的默认 Workflow。
 * v1 尚无流程选择参数，按各模块清单首项为默认；空清单显式采用 general，不继承父模块。
 */
export async function resolveDispatchModules(snapshot:Snapshot,moduleIds:string[]):Promise<ModuleBinding[]>{
  assertSnapshot(snapshot);
  if(!Array.isArray(moduleIds)||!moduleIds.length||moduleIds.length>100||moduleIds.some(id=>typeof id!=='string'||!id.trim())||new Set(moduleIds).size!==moduleIds.length)fail('MODULE_MISSING','任务需要 1–100 个不重复的真实模块 ID');
  const people=new Set<string>(data(snapshot,'.cbim/team/people.json').people.map((person:{id:string})=>person.id));
  const workspace=new BusinessWorkspace(snapshot),bindings:ModuleBinding[]=[];
  for(const moduleId of moduleIds){
    if(!Object.hasOwn(snapshot.validation!.tree.nodes,moduleId))fail('MODULE_MISSING',`模块不存在：${moduleId}`);
    const module=await workspace.module(moduleId),maintenance=module.definition.maintenance as ModuleMaintenanceDefinition|undefined;
    if(!maintenance||maintenance.state!=='active'||!maintenance.maintainerPersonIds.length||maintenance.maintainerPersonIds.some(id=>!people.has(id)))fail('MAINTAINER_UNCONFIRMED',`模块尚无有效维护关系：${moduleId}`);
    const workflow=module.workflows[0];
    bindings.push({moduleId,name:module.definition.name,knowledgeRevision:snapshot.revision,
      maintenanceBindingId:maintenance.bindingId,maintainerPersonIds:[...maintenance.maintainerPersonIds],
      workflow:workflow?{kind:'module',id:workflow.id,version:hash(textOf(workflow.content))}
        :{kind:'general',id:'cbim:general',version:'1',reason:'本模块未挂载专属 Workflow，采用 CBIM 通用任务流程'},
    });
  }
  return bindings;
}
