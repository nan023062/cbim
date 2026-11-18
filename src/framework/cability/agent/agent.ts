import type { AgentDefinition } from './description';
/**
 * 作用定位：Framework 虚拟角色 对象，冻结能力、运行选型和权限，并引用真实对话身份。
 * 设计原因：主与执行是调用角色而非两套对象；对象不持调度器、SDK 或重复消息正文。
 */
import type { Team } from '../team';

export interface OfficeObservation
{
  organization?: Team;
  modules: readonly { id: string; ownerMemberId?: string }[];
  reason?: string;
}


/** 对话正文属于运行日志；此处只保留可核验身份，不能用显示名称关联。 */
export interface AgentConversation
{
  workspaceId: string;

  taskId: string
}

/** 一次受理中的冻结 Agent；调度与循环依赖本对象，不反向持有它们。 */
export class Agent
{
  readonly definition: Readonly<AgentDefinition>;

  readonly conversation: Readonly<AgentConversation>;

  constructor(definition: AgentDefinition, conversation: AgentConversation, readonly Observe?: () => Promise<OfficeObservation>)
  {
    if (!definition.id || !definition.name || !conversation.taskId || !conversation.workspaceId)
      throw Error('Agent 身份不完整');

    this.definition = Object.freeze({ ...definition, references: Object.freeze([...(definition.references ?? [])]), effectiveSkills: Object.freeze((definition.effectiveSkills ?? []).map(skill => Object.freeze({ ...skill }))), ...(definition.model ? { model: Object.freeze({ ...definition.model }) } : {}) });

    this.conversation = Object.freeze({ ...conversation });
  }
}
