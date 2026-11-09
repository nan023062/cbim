/**
 * 作用定位：把成员公开事件分页归并为稳定的运行视图，供卡片与任务详情共用。
 * 设计原因：只接收同一工作区、主会话、任务和轮次的连续事件；无变化保留引用，旧响应不能回退正文或把另一个成员的内容混入当前视图。
 */
import type {MemberEventsRead,MemberEventCursor} from '../../bridge/contracts/dispatch';
import type {RunSummary,StoredEvent} from '../../bridge/contracts/execution';

/** 由发起请求的视图固定的观察范围；相同成员的不同任务、轮次不能共用游标。 */
export interface MemberEventScope {
  workspaceId:string;
  /** 主会话身份随 IPC 请求由后端核验；公开事件自身不携带此字段。 */
  rootSessionId:string;
  /** 派发任务 ID，不是主会话 taskId 或成员的原生会话 ID。 */
  taskId:string;
  /** 本次执行尝试；切换历史轮次时重新建立投影。 */
  runId:string;
}
/** 单个观察作用域的内存投影，页面卸载后不作为后端运行状态保存。 */
export interface MemberEventState {
  scope:MemberEventScope;
  /** 缺省表示尚未接受首个 reset；推进到最后完整合并的事件序号。 */
  cursor?:MemberEventCursor;
  /** 由公开运行概要与已接收事件组成，缺省表示还没有可信响应。 */
  run?:RunSummary;
  /** 即使运行已结算，仍须补齐后续分页，才能停止轮询。 */
  hasMore:boolean;
}
/** 同时编码四层身份，供 Hook 隔离状态；该键不构成后端访问授权。 */
export const memberEventKey=(scope:MemberEventScope)=>JSON.stringify([scope.workspaceId,scope.rootSessionId,scope.taskId,scope.runId]);
/** 空状态不代表已经收到日志，首次响应须为 reset。 */
export function emptyMemberEvents(scope:MemberEventScope):MemberEventState{return {scope:{...scope},hasMore:false}}
/** 下次读取间隔（毫秒）；终态仍须补完 hasMore，读完才停止，starting 的空前缀继续等待。 */
export function memberPollDelay(state:MemberEventState,background:boolean,failed=false):number|undefined{
  if(failed)return background?5000:2000;
  if(state.hasMore)return 0;
  if(!state.run||state.run.status==='running')return background?5000:1000;
  return undefined;
}

/**
 * 纯增量归并，不修改历史对象。连续重复片段幂等，同序号不同正文或跳号拒绝后由调用方重载。
 * noop 可携带最新结算状态，因此相同游标仍核对公开运行概要，不强制重建无变化视图。
 * 此处校验响应中的 workspace/task/run；rootSessionId 由后端请求核验与 Hook 的作用域代际共同保证。
 */
export function applyMemberEvents(state:MemberEventState,reply:MemberEventsRead):MemberEventState{
  const {scope}=state;
  if(reply.cursor.runId!==scope.runId||reply.run.runId!==scope.runId||reply.run.task.workspaceId!==scope.workspaceId||reply.run.task.taskId!==scope.taskId)throw Error('成员运行身份不一致，请重新打开任务');
  if(!Number.isSafeInteger(reply.cursor.seq)||reply.cursor.seq<0)throw Error('成员运行游标无效，请重新读取');
  if(state.cursor&&reply.cursor.seq<state.cursor.seq)return state;
  if(reply.mode!=='reset'&&!state.cursor)throw Error('成员运行缺少初始记录，请重新读取');
  if(reply.mode==='noop'&&reply.cursor.seq!==state.cursor?.seq)throw Error('成员运行游标有缺口，请重新读取');
  const previous=state.run?.events??[];
  let events=reply.mode==='reset'?[] as StoredEvent[]:previous;
  if(reply.mode!=='noop'){
    const appended:StoredEvent[]=[];
    let seq=reply.mode==='reset'?0:state.cursor!.seq;
    for(const event of reply.events){
      if(event.workspaceId!==scope.workspaceId||event.taskId!==scope.taskId||event.runId!==scope.runId||!Number.isSafeInteger(event.seq)||event.seq<1)throw Error('成员事件身份无效，请重新读取');
      if(event.seq<=seq){const known=events[event.seq-1]??appended.find(item=>item.seq===event.seq);if(!known||JSON.stringify(known)!==JSON.stringify(event))throw Error('成员事件内容冲突，请重新读取');continue}
      if(event.seq!==seq+1)throw Error('成员运行事件不连续，请重新读取');
      appended.push(event);seq=event.seq;
    }
    if(seq!==reply.cursor.seq)throw Error('成员运行分页不完整，请重新读取');
    if(appended.length)events=[...events,...appended];
    if(reply.mode==='reset'&&events.length===previous.length&&events.every((item,index)=>JSON.stringify(item)===JSON.stringify(previous[index])))events=previous;
  }
  const oldView=state.run?(({events:_,...view})=>view)(state.run):undefined;
  const viewUnchanged=JSON.stringify(oldView)===JSON.stringify(reply.run);
  const run=state.run&&events===previous&&viewUnchanged?state.run:{...reply.run,events};
  const cursor=state.cursor?.seq===reply.cursor.seq?state.cursor:{...reply.cursor};
  const hasMore=reply.mode==='noop'?false:reply.hasMore;
  if(run===state.run&&cursor===state.cursor&&state.hasMore===hasMore)return state;
  return {scope,cursor,run,hasMore};
}
