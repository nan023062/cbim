import type { AgentDefinition } from './description';

/**
 * 作用定位：Framework 虚拟角色 对象，冻结能力、运行选型和权限，并引用真实对话身份。
 * 设计原因：主与执行是调用角色而非两套对象；对象不持调度器、SDK 或重复消息正文。
 */
import type { Team } from '../team';

export interface OfficeObservation
{
  organization?:
  {
    readonly kind: 'organization';

    readonly id: string;

    readonly children: Team['children']
  };

  modules: readonly
  {
    id: string;

    ownerMemberId?: string
  }[];

  reason?: string;
}

/** 对话正文属于运行日志；此处只保留可核验身份，不能用显示名称关联。 */
export interface AgentConversation
{
  workspaceId: string;

  taskId: string
}

/** 一次受理中的冻结 Agent；调度与循环依赖本对象，不反向持有它们。 */
export class AgentRole
{
  public readonly definition: Readonly<AgentDefinition>;

  public readonly conversation: Readonly<AgentConversation>;

  public constructor(definition: AgentDefinition, conversation: AgentConversation, public readonly Observe?: () => Promise<OfficeObservation>)
  {
    if (!definition.id || !definition.name || !conversation.taskId || !conversation.workspaceId)
      throw Error('Agent 身份不完整');

    this.definition = Object.freeze({ ...definition, skills: Object.freeze((definition.skills ?? []).map(skill => Object.freeze({ ...skill }))), connectorIds: Object.freeze([...(definition.connectorIds ?? [])]), references: Object.freeze([...(definition.references ?? [])]), effectiveSkills: Object.freeze((definition.effectiveSkills ?? []).map(skill => Object.freeze({ ...skill }))), ...(definition.model ? { model: Object.freeze({ ...definition.model }) } : {}) });

    this.conversation = Object.freeze({ ...conversation });
  }
}
