/**
 * 作用定位：Builtins：从业务模块代码常量发布内置 Skill、规范和 Schema，包括团队/业务架构治理及只需简述、补充自愿的反馈流程。
 * 设计原因：只允许白名单资料 ID，返回正文、版本和引用；读取反馈 Skill 不会创建 GitHub Issue，也不扩大文件或网络权限。
 * 资源边界：全部内置正文随业务代码编译；不访问 assets、design 或 docs 文件。
 */
import path from 'node:path';

import { bugFeedback, featureWish } from '../../feedback/index';

import { commonRules, knowledgeQuery, knowledgeGovernance, sharedSkillsWorkflows } from './standards';

import { architectureSpec, architectureGovernance, teamArchitectureGovernance, businessArchitectureGovernance, coreCheck } from '../../governance/rules/standards';

import { moduleSpec, moduleSchema, createWorkflow } from '../../workspace/rules/standards';

import { agentSpec, agentSchema, agentRegistrySchema, teamSkillsSchema, createAgentSkill } from '../../team/rules/standards';

import { taskSpec, taskLoop, baseTask, taskBaseline, businessExecution } from '../../tasks/rules/standards';

import { connectorSpec, connectorSchema } from '../../connectors/rules/standards';

import { hash } from '../../../core/io/serialization';

/** 产品内置流程清单；知识工具为每项注册只读 cbim_skill_* 别名，正文随所属业务模块编译。 */
export const builtinSkills = [{ id: 'bug-feedback', title: 'BUG 反馈', description: '一句问题即可反馈 CBIM 缺陷，复现步骤、结果和环境自愿补充，不强制追问' }, { id: 'feature-wish', title: '需求许愿', description: '一句愿望即可提交 CBIM 需求，使用场景、困难和例子自愿补充，不强制追问' }, { id: 'knowledge-query', title: '知识查询', description: '定位权威知识、核实证据并回答，默认只读' }, { id: 'business-execution', title: '需求实现', description: '定位模块和 Agent，组织实现、验证与交付' }, { id: 'knowledge-governance', title: '知识治理', description: '检查事实、结构和引用，在授权内通过内部知识工具预览、提交和复核' }, { id: 'architecture-governance', title: '架构治理', description: '模式观察、架构评估、人工决定与渐进演进' }, { id: 'team-architecture-governance', title: '团队架构治理', description: '核实团队职责、能力与继承 Skill，在当前权限内预览、提交和复核团队知识' }, { id: 'business-architecture-governance', title: '业务架构治理', description: '按真实模块、代码和单向依赖渐进治理，校验知识结构并保留业务验收边界' }, { id: 'create-agent-skill', title: '创建 Agent/Team Skill', description: '为已有组织节点创建专业 Skill，维护清单并检查继承' }, { id: 'create-workflow', title: '创建模块 Workflow', description: '为已有模块创建独立流程并维护本模块清单' }, { id: 'core-check', title: 'Core 检查', description: '仅在用户明确要求时检查分层、文档职责与继承' },];

/** 只读注册表；referenceBase 仅解释旧正文中的相对链接，不是磁盘路径。 */
const entries = [
  { id: 'bug-feedback', kind: 'skill', title: 'BUG 反馈', source: 'src/logic/feedback/skills.ts#bugFeedback', referenceBase: 'runtime/bug-feedback.md', text: bugFeedback },
  { id: 'feature-wish', kind: 'skill', title: '需求许愿', source: 'src/logic/feedback/skills.ts#featureWish', referenceBase: 'runtime/feature-wish.md', text: featureWish },
  { id: 'knowledge-query', kind: 'skill', title: '知识查询', source: 'src/logic/knowledge/rules/standards.ts#knowledgeQuery', referenceBase: 'runtime/knowledge-query.md', text: knowledgeQuery },
  { id: 'business-execution', kind: 'skill', title: '需求实现', source: 'src/logic/tasks/rules/standards.ts#businessExecution', referenceBase: 'runtime/business-execution.md', text: businessExecution },
  { id: 'architecture-governance', kind: 'skill', title: '架构治理', source: 'src/logic/governance/rules/standards.ts#architectureGovernance', referenceBase: 'runtime/architecture-governance.md', text: architectureGovernance },
  { id: 'team-architecture-governance', kind: 'skill', title: '团队架构治理', source: 'src/logic/governance/rules/standards.ts#teamArchitectureGovernance', referenceBase: 'runtime/team-architecture-governance.md', text: teamArchitectureGovernance },
  { id: 'business-architecture-governance', kind: 'skill', title: '业务架构治理', source: 'src/logic/governance/rules/standards.ts#businessArchitectureGovernance', referenceBase: 'runtime/business-architecture-governance.md', text: businessArchitectureGovernance },
  { id: 'create-agent-skill', kind: 'skill', title: '创建 Agent/Team Skill', source: 'src/logic/team/rules/standards.ts#createAgentSkill', referenceBase: 'runtime/create-agent-skill.md', text: createAgentSkill },
  { id: 'create-workflow', kind: 'skill', title: '创建模块 Workflow', source: 'src/logic/workspace/rules/standards.ts#createWorkflow', referenceBase: 'runtime/create-workflow.md', text: createWorkflow },
  { id: 'core-check', kind: 'skill', title: 'Core 检查', source: 'src/logic/governance/rules/standards.ts#coreCheck', referenceBase: 'runtime/core-check.md', text: coreCheck },
  { id: 'knowledge-governance', kind: 'skill', title: '知识治理', source: 'src/logic/knowledge/rules/standards.ts#knowledgeGovernance', referenceBase: 'runtime/knowledge-governance.md', text: knowledgeGovernance },
  { id: 'common-rules', kind: 'standard', title: 'CBIM 内部执行与治理通用规范', source: 'src/logic/knowledge/rules/standards.ts#commonRules', referenceBase: 'runtime/common-rules.md', text: commonRules },
  { id: 'module-spec', kind: 'standard', title: 'Module 定义与维护规范', source: 'src/logic/workspace/rules/standards.ts#moduleSpec', referenceBase: 'business/module-spec.md', text: moduleSpec },
  { id: 'agent-spec', kind: 'standard', title: 'Agent 定义与维护规范', source: 'src/logic/team/rules/standards.ts#agentSpec', referenceBase: 'capability/agent-spec.md', text: agentSpec },
  { id: 'architecture-spec', kind: 'standard', title: '架构评估与认知交付规范', source: 'src/logic/governance/rules/standards.ts#architectureSpec', referenceBase: 'task/architecture-spec.md', text: architectureSpec },
  { id: 'task-baseline', kind: 'standard', title: '任务知识基线与恢复', source: 'src/logic/tasks/rules/standards.ts#taskBaseline', referenceBase: 'task/task-baseline.md', text: taskBaseline },
  { id: 'task-spec', kind: 'standard', title: 'Task 定义', source: 'src/logic/tasks/rules/standards.ts#taskSpec', referenceBase: 'task/task-spec.md', text: taskSpec },
  { id: 'task-loop', kind: 'standard', title: 'Task Loop', source: 'src/logic/tasks/rules/standards.ts#taskLoop', referenceBase: 'task/task-loop.md', text: taskLoop },
  { id: 'base-task', kind: 'standard', title: 'Task 基础抽象', source: 'src/logic/tasks/rules/standards.ts#baseTask', referenceBase: 'task/base-task.md', text: baseTask },
  { id: 'shared-skills-workflows', kind: 'standard', title: '团队 Skill 与模块 Workflow 结构', source: 'src/logic/knowledge/rules/standards.ts#sharedSkillsWorkflows', referenceBase: 'runtime/shared-skills-workflows.md', text: sharedSkillsWorkflows },
  { id: 'module-schema', kind: 'schema', title: 'Module Schema', source: 'src/logic/workspace/rules/standards.ts#moduleSchema', referenceBase: 'business/module.schema.json', text: moduleSchema },
  { id: 'agent-schema', kind: 'schema', title: 'Agent Schema', source: 'src/logic/team/rules/standards.ts#agentSchema', referenceBase: 'capability/agent.schema.json', text: agentSchema },
  { id: 'team-skills-schema', kind: 'schema', title: 'Team Skill Schema', source: 'src/logic/team/rules/standards.ts#teamSkillsSchema', referenceBase: 'capability/team-skills.schema.json', text: teamSkillsSchema },
  { id: 'connector-schema', kind: 'schema', title: '连接器 Schema', source: 'src/logic/connectors/rules/standards.ts#connectorSchema', referenceBase: 'connector/registry.schema.json', text: connectorSchema },
  { id: 'agent-registry-schema', kind: 'schema', title: 'Agent 注册表 Schema', source: 'src/logic/team/rules/standards.ts#agentRegistrySchema', referenceBase: 'capability/registry.schema.json', text: agentRegistrySchema },
  { id: 'connector-spec', kind: 'standard', title: '连接器定义规范', source: 'src/logic/connectors/rules/standards.ts#connectorSpec', referenceBase: 'connector/connector-spec.md', text: connectorSpec },
];

const contract = '内置资料只读，版本由内容 SHA-256 标识。查询以内部知识服务当前返回值为准；Agent 的原生工具禁止直接读写 .cbim；全部知识 CRUD 由受授权的内部工具执行，使用 cbim_object_preview/cbim_object_commit 或受控知识事务接口。派生注册表由 CBIM 维护。旧 Python 规则工具不是入口。Skill 工具返回流程，不会替 Agent 执行任务；结构校验不能替代语义与人工判断。';

export class Builtins
{
  /** 无状态目录；禁止实例化，正文由模块常量唯一拥有。 */
  private constructor()
  {
  }

  /** 生成全新回执，调用方不能修改注册项；摘要始终来自实际返回正文。 */
  private static Document(entry: typeof entries[number])
  {
    const { referenceBase, ...document } = entry;

    return { ...document, version: hash(document.text), readOnly: true };
  }

  /** 返回允许读取的全部内置资源及内容身份，不安装 Skill 或启动其流程。 */
  static async Catalog()
  {
    const items = await Promise.all(entries.map(async entry => { const { text, ...metadata } = await this.Document(entry); return metadata }));

    return { entryId: 'knowledge-governance', contract, revision: hash(JSON.stringify(items)), items };
  }

  /** 只读白名单正文；可核对原版本，不把读取成功解释成反馈提交或业务执行成功。 */
  static async Read(id: string, expectedVersion?: string)
  {
    const entry = entries.find(e => e.id === id);

    if (!entry)
      throw new Error('未知内置资料 ID，请先调用 cbim_builtin_catalog');

    const result = await this.Document(entry);

    if (expectedVersion && expectedVersion !== result.version)
      throw new Error('内置资料版本已变化，请重新查询清单并核对');

    const prose = result.text.replace(/(`{3,}|~{3,})[^\n]*\n[\s\S]*?\1/g, '');

    const links = [...prose.matchAll(/\]\(<?([^\s)>]+)>?(?:\s+"[^"]*")?\)/g), ...prose.matchAll(/^\s*\[[^\]]+\]:\s*<?([^\s>]+)>?/gm)];

    const references = [...new Set(links.map(m => m[1]))].map(reference => { const [target, anchor] = reference.split('#'); const found = target.startsWith('builtin:') ? entries.find(e => e.id === target.slice(8)) : entries.find(e => e.referenceBase === path.posix.normalize(path.posix.join(path.posix.dirname(entry.referenceBase), target))); return { reference, anchor, id: found?.id, status: found ? 'available' : reference.startsWith('#') ? 'same_document' : /^https?:/.test(reference) ? 'external' : 'unavailable' }; });

    return { ...result, contract, references };
  }
}
