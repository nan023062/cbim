/**
 * 作用定位：定义独立成员执行的可信身份与原生会话启动参数，供调度、大脑和运行日志共用。
 * 设计原因：业务 taskId、一次 runId 与成员的 agentSessionId 分开，允许同一通道先后处理不同任务；旧对话仍使用原 start/resume 协议。
 * 职责边界：这里只校验身份，不签发租约、权限或恢复许可；sessionFile 属于后端私有启动数据，不进入公开任务图。
 */
import {safeId} from '../foundation/identity';
import {fail} from '../foundation/errors';
import type {TaskSpec} from '../tasks/types';

/** 调度先可靠保存执行意图，再把这份固定绑定交给大脑；runId 不能由模型生成。 */
export interface MemberRunBinding {
  workspaceId:string;
  /** 知识中的组织与角色身份；与持久化成员实例分开，不能用展示名称替代。 */
  teamId:string;
  agentId:string;
  /** 工作区内稳定成员身份；跨主会话复用，同一时刻只能占用一个执行槽。 */
  agentInstanceId:string;
  /** 当前成员在 rootSessionId 下的逻辑通道；不同业务任务可先后使用，区别于 Pi 原生 sessionId。 */
  agentSessionId:string;
  /** 拥有派发图的主会话；不是本次业务任务或原生引擎会话。 */
  rootSessionId:string;
  /** 派发图中的业务任务身份。 */
  taskId:string;
  /** 本次运行的预分配身份；回调、日志和领取信封必须引用同一值。 */
  runId:string;
  /** 成员执行租约代际；跨进程迟到结果由调度核对，不随稳定成员 ID 一起重置。 */
  leaseEpoch:number;
  /** 本次执行所依据的业务节点计划版本，与任务内步骤版本不同。 */
  planRevision:number;
}

/**
 * 后端启动参数；跨任务复用同成员通道不属于旧 TaskSpec 的 resume。
 * 调度必须先确认上轮 completed、没有未决工具，并持有成员和会话执行槽；这里不自动推断恢复安全性。
 */
export interface MemberRunLaunch {
  binding:MemberRunBinding;
  /** 后端通道映射：首次使用只传原生身份，后续任务须同时传已核实的对应会话文件。 */
  session:{nativeSessionId:string;sessionFile?:string};
}

/** 校验运行日志或启动绑定与实际任务/轮次一致；返回独立快照，避免调用方随后修改身份。 */
export function checkedMemberRunBinding(value:unknown,task:TaskSpec,runId?:string):MemberRunBinding{
  if(!value||typeof value!=='object'||Array.isArray(value))fail('MEMBER_RUN_IDENTITY','成员运行缺少固定身份');
  const binding=value as Record<string,unknown>;
  const identifiers=['workspaceId','agentInstanceId','agentSessionId','rootSessionId','taskId','runId'] as const;
  const allowed=[...identifiers,'teamId','agentId','leaseEpoch','planRevision'];
  if(Object.keys(binding).some(key=>!allowed.includes(key)))fail('MEMBER_RUN_IDENTITY','成员运行身份包含未知字段');
  for(const key of identifiers){
    if(typeof binding[key]!=='string')fail('MEMBER_RUN_IDENTITY','成员运行标识必须为字符串');
    // 文件路径标识沿用运行日志限制；逻辑通道/根会话不作目录片段，长度与派发协议一致。
    if(['workspaceId','taskId','runId'].includes(key))safeId(binding[key] as string);
    else if(!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(binding[key] as string))fail('MEMBER_RUN_IDENTITY','成员通道标识无效');
  }
  for(const key of ['teamId','agentId'])if(typeof binding[key]!=='string'||!(binding[key] as string).trim()||(binding[key] as string).length>512)fail('MEMBER_RUN_IDENTITY','成员角色身份无效');
  if(!Number.isSafeInteger(binding.leaseEpoch)||(binding.leaseEpoch as number)<0||!Number.isSafeInteger(binding.planRevision)||(binding.planRevision as number)<1)fail('MEMBER_RUN_IDENTITY','成员租约或计划版本无效');
  if(binding.workspaceId!==task.workspaceId||binding.taskId!==task.taskId||binding.agentId!==task.agentId||runId!==undefined&&binding.runId!==runId)fail('MEMBER_RUN_IDENTITY','成员运行绑定与任务或轮次不一致');
  if(task.mode==='chat'||!task.moduleIds.length)fail('MEMBER_RUN_IDENTITY','成员业务运行需要明确的模块任务，不能借用普通对话身份');
  return structuredClone(value) as MemberRunBinding;
}

/** 校验后端启动数据，不读取会话文件；Pi 适配器还须核对文件归属与实际原生 sessionId。 */
export function checkedMemberRunLaunch(value:MemberRunLaunch,task:TaskSpec):MemberRunLaunch{
  const binding=checkedMemberRunBinding(value?.binding,task);
  if(!value.session||typeof value.session.nativeSessionId!=='string')fail('MEMBER_RUN_IDENTITY','成员运行缺少原生会话身份');
  safeId(value.session.nativeSessionId);
  if(value.session.sessionFile!==undefined&&(typeof value.session.sessionFile!=='string'||!value.session.sessionFile.trim()))fail('MEMBER_RUN_IDENTITY','成员原生会话路径无效');
  return {binding,session:{nativeSessionId:value.session.nativeSessionId,...(value.session.sessionFile?{sessionFile:value.session.sessionFile}:{})}};
}
