/**
 * 作用定位：静态 Agent 会话历史的持久化索引契约，连接调度查询服务与本机磁盘适配。
 * 设计原因：索引只保存可核验归属和公开摘要，正文继续属于原运行日志；目录定位由后端 source 与 task/run 标识确定，不接受前端路径。
 */
import {z} from 'zod';
import type {TaskSpec} from '../tasks/types';
import type {AgentHistoryRun,AgentHistorySession,AgentHistoryStatus} from './session-history';

/** 单轮派生索引；dispatchStatus 是已提交的成员领取/终态，不能被较迟到的原生日志恢复覆盖。 */
export interface AgentHistoryRecord {
  version:1;
  view:AgentHistoryRun;
  kind:AgentHistorySession['kind'];
  journal:'loop'|'member';
  /** 仅目标、模块与验收等公开任务字段；禁止 workflowContext、原生路径或角色正文。 */
  task:TaskSpec;
  lastSeq:number;
  /** 只有执行意图时可能尚无 canonical 日志；失败发生在日志创建前仍保留该轮。 */
  journalSeen:boolean;
  dispatchStatus?:AgentHistoryStatus;
}
/** 持久化失败由上层记录诊断；已发生的运行事实不可因为索引写失败而回滚或重新执行。 */
export interface AgentHistoryStore {
  load():Promise<{records:AgentHistoryRecord[];diagnostics:string[]}>;
  put(record:AgentHistoryRecord):Promise<void>;
}

const id=z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/);
const text=z.string().min(1).max(512);
const stamp=z.string().datetime();
const status=z.enum(['starting','running','completed','failed','cancelled','interrupted']);
const task=z.object({mode:z.literal('chat').optional(),taskId:id,workspaceId:id,root:z.string().min(1),goal:z.string(),moduleIds:z.array(z.string()),agentId:text.optional(),responsiblePerson:z.string().optional(),acceptance:z.array(z.string())}).strict();
const view=z.object({workspaceId:id,agentId:text,sessionId:z.string().min(1).max(160),taskId:id,runId:id,
  source:z.enum(['main','member','legacy']),binding:z.enum(['registered','legacy']),agentName:text,goal:z.string(),moduleIds:z.array(z.string()),status,startedAt:stamp,updatedAt:stamp,
  agentSessionId:id.optional(),agentInstanceId:id.optional(),rootSessionId:id.optional(),configurationRevision:z.string().optional(),
}).strict();
const shape=z.object({version:z.literal(1),view,kind:z.enum(['conversation','task','legacy']),journal:z.enum(['loop','member']),task,lastSeq:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),journalSeen:z.boolean(),dispatchStatus:status.optional()}).strict();

/** 索引损坏不能制造另一角色或运行的定位；只验证现有字段，不补造任何旧身份。 */
export function checkedAgentHistoryRecord(value:unknown,workspaceId:string,root:string):AgentHistoryRecord{
  const result=shape.parse(value),v=result.view,t=result.task;
  if(v.workspaceId!==workspaceId||t.workspaceId!==workspaceId||t.root!==root||v.taskId!==t.taskId||v.agentId!==t.agentId||v.goal!==t.goal||JSON.stringify(v.moduleIds)!==JSON.stringify(t.moduleIds))throw Error('Agent 历史索引身份不一致');
  if(v.binding==='registered'){
    if(!v.agentSessionId||!v.agentInstanceId||!v.rootSessionId||v.sessionId!==v.agentSessionId)throw Error('Agent 历史缺少已登记通道');
    if(v.source==='main'&&(v.agentId!=='cbim:main'||t.mode!=='chat'||v.rootSessionId!==t.taskId||result.kind!=='conversation'||result.journal!=='loop'))throw Error('主会话历史归属无效');
    if(v.source==='member'&&(t.mode==='chat'||result.kind!=='task'||result.journal!=='member'))throw Error('成员历史归属无效');
    if(v.source==='legacy')throw Error('已登记身份不能标记为旧未知通道');
  }else if(v.source!=='legacy'||result.kind!=='legacy'||v.sessionId!==`legacy:${t.taskId}`||v.agentSessionId||v.agentInstanceId||v.rootSessionId||result.journal!=='loop')throw Error('旧历史不得补造实例或通道');
  return structuredClone(result) as AgentHistoryRecord;
}
