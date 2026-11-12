/**
 * 目录归属：backend/scheduler-engine/evidence；目标状态与核证恢复服务。
 * 作用定位：为人工验收和按意见继续提供同一主周期的证据状态指纹。
 * 设计原因：文件、原生日志和知识检查在任务事务之外执行；提交只核原周期、图和运行是否仍与取证时一致，避免反向取得知识锁。
 * 职责边界：这是乐观并发依据，不是业务验收或执行许可；不读文件、不修改状态。
 */
import {hash,json} from '../../core/foundation/serialization';
import type {DispatchState} from '../../core/dispatch/dispatch-storage';

/** 人工决定版本由提交者独立 CAS；其余原周期及关联运行变化均使这次观察失效。 */
export function humanEvidenceStateStamp(state:DispatchState,identity:{rootSessionId:string;scopeId:string}):string{
  const scope=state.scopes?.find(item=>item.scopeId===identity.scopeId&&item.rootSessionId===identity.rootSessionId);
  const {humanDecisions:_,...subject}=scope??{};
  return hash(json({scope:subject,graph:state.graphs.find(graph=>graph.identity.rootSessionId===identity.rootSessionId),runs:state.runs?.filter(run=>run.binding.rootSessionId===identity.rootSessionId),members:state.members.filter(member=>member.executionScopeId===identity.scopeId||member.agentId==='cbim:main'&&member.mainRootSessionId===identity.rootSessionId),sessions:state.sessions.filter(session=>session.rootSessionId===identity.rootSessionId)}));
}
