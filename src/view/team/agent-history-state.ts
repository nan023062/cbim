/**
 * 作用定位：校验并合并角色执行历史的会话/轮次分页，生成完整身份观察键。
 * 设计原因：静态角色可跨主会话复用甚至被删除；页面不能按名称合并执行实例，分页重叠须去重，异步返回的错误归属必须拒绝。
 */
import type {AgentHistoryIdentity,AgentHistorySessionIdentity,AgentHistoryRun,AgentHistorySession,AgentHistoryPage} from '../../bridge/contracts/agent-history';
import type {MemberEventScope} from '../tasks/member-event-state';

type HistoryItem=AgentHistorySession|AgentHistoryRun;
/** 身份键包含角色与历史分组，legacy 的 sessionId 只作索引，不声明真实运行通道。 */
export const historyScopeKey=(identity:AgentHistoryIdentity&{sessionId?:string})=>JSON.stringify([identity.workspaceId,identity.agentId,identity.sessionId??'']);
/** 同一运行在不同索引作用域不能共用正在读取的请求和事件状态。 */
export const historyRunKey=(run:AgentHistoryRun)=>JSON.stringify([run.workspaceId,run.agentId,run.sessionId,run.taskId,run.runId]);
const itemKey=(item:HistoryItem)=>'runId' in item?JSON.stringify([item.sessionId,item.taskId,item.runId]):item.sessionId;

/** 保留服务端顺序；重叠项更新原位置，首次/刷新替换列表，加载更多只追加新身份。 */
export function mergeHistoryPage<T extends HistoryItem>(previous:AgentHistoryPage<T>|undefined,page:AgentHistoryPage<T>,identity:AgentHistoryIdentity|AgentHistorySessionIdentity,append=false):AgentHistoryPage<T>{
  for(const item of page.items){
    if(item.workspaceId!==identity.workspaceId||item.agentId!==identity.agentId||('sessionId' in identity&&item.sessionId!==identity.sessionId))throw Error('执行历史归属不一致，请重新读取');
  }
  const items=append?[...(previous?.items??[])]:[];
  for(const item of page.items){const index=items.findIndex(old=>itemKey(old)===itemKey(item));if(index<0)items.push(item);else items[index]=item}
  return {items,nextCursor:page.nextCursor,diagnostics:[...new Set([...(append?previous?.diagnostics??[]:[]),...page.diagnostics])]};
}

/** 事件协议沿用成员公开投影；旧记录缺少 root 时保持空值，不根据静态角色补造主会话身份。 */
export function historyEventScope(run:AgentHistoryRun):MemberEventScope{return {workspaceId:run.workspaceId,rootSessionId:run.rootSessionId??'',taskId:run.taskId,runId:run.runId}}
