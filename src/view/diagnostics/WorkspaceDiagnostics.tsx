/**
 * 作用定位：只读展示工作区内部运行状态和知识校验问题。
 * 设计原因：运行是否就绪与知识是否有效是两件事，分别展示并保留问题路径，方便用户定位治理事项。
 * 职责边界：用户可刷新检查结果，组件不改变运行生命周期或知识内容。
 */
import {useState} from 'react';
import type {Snapshot,WorkspaceView} from '../../bridge/contracts/workspace';
import './diagnostics.css';

/** 知识刷新回调固定绑定当前工作区，仅重新读取并检查知识。 */
interface WorkspaceDiagnosticsProps {
  workspace:WorkspaceView;
  snapshot?:Snapshot;
  refreshKnowledge:()=>Promise<unknown>;
}

const stateLabels:Record<string,string>={registered:'已登记',running:'运行中',opening:'正在打开',closing:'正在关闭',closed:'已关闭',missing:'路径失效',failed:'打开失败',recovery_required:'需要恢复'};

/** 校验结果来自知识快照；没有快照时明确显示待加载，不将缺失结果当作检查通过。 */
export function WorkspaceDiagnostics({workspace,snapshot,refreshKnowledge}:WorkspaceDiagnosticsProps){
  const [refreshing,setRefreshing]=useState(false),[error,setError]=useState('');
  const validation=snapshot?.validation,issues=validation?.issues||[],errors=issues.filter(issue=>issue.severity==='error');
  const disabled=refreshing||workspace.state!=='running';
  async function refresh(){
    setRefreshing(true);setError('');
    try{await refreshKnowledge()}catch(e){setError(e instanceof Error?e.message:String(e))}finally{setRefreshing(false)}
  }
  return <section className="workspace-diagnostics" aria-label={`${workspace.name} 的工作区状态`}>
    <header><h2>工作区状态</h2><p>{stateLabels[workspace.state]||workspace.state}</p></header>
    {(error||workspace.error)&&<p role="alert">{error||workspace.error}</p>}
    <section className="knowledge-diagnostics" aria-label="知识校验问题">
      <h3>知识校验</h3><p>{validation?`${errors.length} 条错误 · ${issues.length-errors.length} 条警告`:`${workspace.knowledgeErrors||0} 条已知错误 · 等待加载检查结果`}</p>
      <button disabled={disabled} onClick={()=>void refresh()}>{refreshing?'正在检查…':'重新检查知识'}</button>
      <p>以下为程序检查结果，未自动修改知识文件。结构检查通过后，架构语义仍需团队判断。</p>
      {issues.map((issue,index)=><article className={'knowledge-issue '+issue.severity} key={`${issue.code}:${issue.path}:${index}`}><b>{issue.severity==='error'?'错误':'警告'} · {issue.code}</b><p className="knowledge-issue-path">{issue.path}</p><p>{issue.message}</p></article>)}
      {validation&&!issues.length&&<p>当前未发现知识校验问题。</p>}
    </section>
  </section>;
}
