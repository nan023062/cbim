/**
 * 作用定位：将应用级当前运行快照投影为各工作区的活跃主会话 ID。
 * 设计原因：成员独立运行也应点亮原会话；只信任 ready 工作区和真实运行状态，不把历史 running 日志、排队或持久等待当作执行。
 */
import type {RuntimeSnapshot} from '../../bridge/contracts/runtime';
/** 无可用快照时不展示运行灯；仅返回展示身份，不授予继续或停止权限。 */
export function runningConversations(snapshot:RuntimeSnapshot):Record<string,string[]>{
  const result:Record<string,string[]>={},ready=new Set(snapshot.workspaces.filter(item=>item.availability==='ready').map(item=>item.workspaceId));
  for(const run of snapshot.runs){
    if(run.status!=='running'||!ready.has(run.workspaceId))continue;
    const root=run.memberBinding?.rootSessionId??run.conversationBinding?.rootSessionId;
    if(root){const ids=result[run.workspaceId]??=[];if(!ids.includes(root))ids.push(root)}
  }
  return result;
}
