/**
 * 作用定位：提供 CBIM 内置默认执行角色的静态定义及当前 Team 根 Skill 的只读装配。
 * 设计原因：空团队也需要可派发的业务执行角色，默认角色由应用提供而不写入项目知识；其动态实例与主调度实例分离，主 Agent 可直接治理知识但不替代业务执行者，模块 Workflow 仍由正式任务解析器绑定。
 */
import path from 'node:path';
import {fail} from '../../core/foundation/errors';
import {content,data} from '../../core/knowledge/snapshot';
import type {Snapshot} from '../../core/knowledge/types';
import type {AgentConfigurationSnapshot} from '../../core/team/agent-types';

export const defaultExecutorId='cbim:executor';
/** 静态角色不是动态实例，不包含会话、工具授权或可修改的项目文件路径。 */
export const defaultExecutorDefinition={id:defaultExecutorId,name:'CBIM 默认执行 Agent',source:'builtin',summary:'在没有合适自定义执行角色时承担目标模块的自主探索、实现和验证；仅执行，不调度。',capabilities:['目标模块探索、实现与验证'],limitations:['遵守任务模块范围、验收基线和运行权限；不派发其他成员'],connectors:[],authors:[]};
export const defaultExecutorInstructions=`你是 CBIM Team 的默认执行 Agent，角色 ID 为 cbim:executor。
你使用独立于主调度 Agent 的执行实例和会话，具备自身状态与模型思考能力，负责自主探索、实现和验证已派发的目标模块；不能派发或指挥其他成员。
遵守 Team 根继承的有效 Skill，以及各目标模块自己的 Workflow；通用流程仅在目标模块明确标记 general 时采用。角色知识和维护关系不扩大实际运行权限。
通过 cbim_ 内部工具理解真实 Team 环境和模块边界，遇到范围外协作需要时报告事实、所需能力和未完成限制，由主调度 Agent 安排。主 Agent 同时负责团队与业务知识管理，可通过受控知识服务治理架构；这不代表主 Agent 会替你实现或验证业务产物。
所有 .cbim/ 查询与修改均经 cbim_ 知识服务，不通过原生工具直接读写；知识修改仍须处于本任务范围和当前权限内，遵守 read/ask/execute 门禁、审批、版本核验和事务。任务外的团队或业务架构调整报告给主 Agent，不自行扩大执行范围。
使用任务工具记录目标、步骤、实际证据和交付候选；最终文本不等于完成验收，状态由可靠调度与运行事件维护。`;

/** 只装配通过结构校验的快照；继承 Team 根 Skill，缺失正文拒绝正式执行，不降级为空知识。 */
export function defaultExecutorConfiguration(snapshot:Snapshot):AgentConfigurationSnapshot{
  if(!snapshot.workspaceId||!snapshot.revision||!snapshot.validation?.structural)fail('KNOWLEDGE_INVALID','默认执行角色需要通过结构校验的知识快照');
  const ownerId='.cbim/team',definition=data(snapshot,ownerId+'/skills.json');
  return {workspaceId:snapshot.workspaceId,teamId:ownerId,agentId:defaultExecutorId,knowledgeRevision:snapshot.revision,name:defaultExecutorDefinition.name,source:'builtin',principles:defaultExecutorInstructions,
    effectiveSkills:definition.skills.map((skill:{reference:string})=>{const body=content(snapshot,ownerId,skill.reference);if(!body.available||!('text' in body)||typeof body.text!=='string')fail('KNOWLEDGE_INVALID','默认执行角色的继承 Skill 正文不可用');return {skillId:path.posix.dirname(path.posix.join(ownerId,skill.reference)),ownerId,inherited:true,content:body.text}})};
}
