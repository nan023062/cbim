/**
 * 作用定位：Logic 中独立 Agent 对象，冻结能力、运行选型和权限，并引用真实对话身份。
 * 设计原因：主与执行是调用角色而非两套对象；对象不持调度器、SDK 或重复消息正文。
 */
import type { ChatPermission } from '../tools/rules/policy/types';

export interface AgentDefinition
{
  id: string;

  name: string;

  instructions: string;

  permission: ChatPermission;

  /** 已解析、无凭据的执行选择；不允许子调用静默使用另一个模型。 */
  model?: Readonly<
    {
      engine: string;

      profileId: string;

      modelId: string
    }>;
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

  constructor(definition: AgentDefinition, conversation: AgentConversation)
  {
    if (!definition.id || !definition.name || !conversation.taskId || !conversation.workspaceId)
      throw Error('Agent 身份不完整');
    this.definition = Object.freeze({ ...definition, ...(definition.model ? { model: Object.freeze({ ...definition.model }) } : {}) });
    this.conversation = Object.freeze({ ...conversation });
  }
}
