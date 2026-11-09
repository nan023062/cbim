/**
 * 作用定位：定义主对话与已登记 Agent 实例、逻辑会话之间的可信绑定，供运行时和日志恢复共用。
 * 设计原因：同一主会话的聊天与派发图引用同一个主实例，只负责调度；业务执行属于独立执行实例，单独绑定避免混合双方身份或原生历史。
 * 职责边界：绑定只能由后端已登记实例装配；这里只校验一致性，不创建实例、不选择通道，也不签发权限或租约。
 */
import {safeId} from '../foundation/identity';
import {fail} from '../foundation/errors';
import type {TaskSpec} from '../tasks/types';

/** 主会话可信身份快照；不同主会话各有自己的主实例，角色名称相同不代表实例相同。 */
export interface ConversationAgentBinding {
  workspaceId:string;
  /** 该主实例所属团队的知识身份；不能用展示名称代替。 */
  teamId:string;
  /** 当前普通对话只使用内置主角色 cbim:main。 */
  agentId:string;
  /** 当前主会话在后端登记的实例；与该会话任务图根引用同一实例。 */
  agentInstanceId:string;
  /** 主对话逻辑通道；图根另有结果邮箱，正式业务执行使用其他执行实例。 */
  agentSessionId:string;
  /** 兼容现有聊天日志时等于 TaskSpec.taskId，不表示已经创建业务任务节点。 */
  rootSessionId:string;
}

/** 校验后端绑定与普通主对话一致并复制；旧日志没有该字段时由调用者保留缺省，不能按角色名补造。 */
export function checkedConversationAgentBinding(value:unknown,task:TaskSpec):ConversationAgentBinding{
  if(!value||typeof value!=='object'||Array.isArray(value))fail('CONVERSATION_IDENTITY','主对话缺少固定实例身份');
  const binding=value as Record<string,unknown>;
  const identifiers=['workspaceId','agentInstanceId','agentSessionId','rootSessionId'] as const;
  const allowed=[...identifiers,'teamId','agentId'];
  if(Object.keys(binding).some(key=>!allowed.includes(key)))fail('CONVERSATION_IDENTITY','主对话实例身份包含未知字段');
  for(const key of identifiers){
    if(typeof binding[key]!=='string')fail('CONVERSATION_IDENTITY','主对话实例标识必须为字符串');
    // 根会话仍映射到旧聊天日志的 taskId 目录，沿用该目录标识限制。
    if(key==='workspaceId'||key==='rootSessionId')safeId(binding[key] as string);
    else if(!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(binding[key] as string))fail('CONVERSATION_IDENTITY','主对话实例或通道标识无效');
  }
  if(typeof binding.teamId!=='string'||!binding.teamId.trim()||binding.teamId.length>512)fail('CONVERSATION_IDENTITY','主对话团队身份无效');
  if(task.mode!=='chat'||task.agentId!=='cbim:main'||binding.agentId!=='cbim:main')fail('CONVERSATION_IDENTITY','主对话实例绑定只适用于 cbim:main 普通对话');
  if(binding.workspaceId!==task.workspaceId||binding.rootSessionId!==task.taskId)fail('CONVERSATION_IDENTITY','主对话实例绑定与工作区或根会话不一致');
  return structuredClone(value) as ConversationAgentBinding;
}
