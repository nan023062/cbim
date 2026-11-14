/**
 * 作用定位：治理历史中呈现观察和提案的可信来源，区分本机明确提交、主 Agent 运行与未记录来源的旧数据。
 * 设计原因：模型提出方案与人工批准是两种事实；显示原根会话、成员通道、run 和 toolCall，便于定位来源，不把缺少来源的旧记录补成用户签署。
 */
import type {ModuleGovernanceOrigin} from '../../bridge/contracts/governance';

/** 仅展示服务返回的公开来源；不会按来源发起运行、自动批准或改变当前会话。 */
export function GovernanceOrigin({origin}:{origin?:ModuleGovernanceOrigin}){
  if(!origin)return <p className="governance-origin" data-testid="governance-origin">历史记录未保存来源，无法确定由本机操作还是主 Agent 提出。</p>;
  if(origin.kind==='local_desktop')return <p className="governance-origin" data-testid="governance-origin">来源：本机明确提交；不代表账号认证或已获批准。</p>;
  return <details className="governance-origin" open data-testid="governance-origin"><summary>来源：主 Agent · 尚不构成人工决定</summary><dl>
    <dt>根会话</dt><dd>{origin.rootSessionId}</dd><dt>主实例</dt><dd>{origin.agentInstanceId}</dd>
    <dt>成员通道</dt><dd>{origin.agentSessionId}</dd><dt>运行</dt><dd>{origin.runId}</dd>
    <dt>工具调用</dt><dd>{origin.toolCallId}</dd><dt>操作</dt><dd>{origin.toolName}</dd>
  </dl></details>;
}
