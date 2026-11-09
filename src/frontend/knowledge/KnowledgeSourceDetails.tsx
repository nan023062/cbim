/**
 * 作用定位：为项目岗位和模块责任共用展示来源身份、未决状态与明确采纳预览。
 * 设计原因：内容相同不能证明对象没有被替换；将历史采纳与当前核实分开呈现，不由界面建立代次或自动迁移关系。
 * 职责边界：只消费 Bridge 协议，不查询服务、不提交命令，也不将来源绑定显示为执行资格。
 */
import type {CapabilitySourceRef,KnowledgeSourceReadState,SourceSelection} from '../../bridge/contracts/knowledge-source';
import './knowledge-source.css';

const labels={untracked:'尚未追踪来源，需明确采纳',current:'已绑定当前来源',needs_adoption:'当前来源尚未采纳',retired:'原来源已退役，需重新采纳',pending:'知识事务尚未核实，暂停新的来源采纳',missing:'当前来源缺失',invalid:'当前来源无效',unverifiable:'来源暂无法核实'};
/** UUID 是后端保存的受控追踪身份；内置能力只显示实际内容引用，不伪造项目代次。 */
function SourceReference({value}:{value:CapabilitySourceRef}){
  return 'kind' in value?<p>CBIM 内置执行者 · 内容指纹 <code>{value.contentHash}</code></p>:<p>{value.source.kind==='agent'?'团队能力':'业务模块'}：<code>{value.source.sourceId}</code><br/>来源代次：<code>{value.generationId}</code></p>;
}

/** 旧记录没有状态或已采纳引用时明确显示缺省，不能据当前路径补造旧身份。 */
export function KnowledgeSourceDetails({state,adopted}:{state?:KnowledgeSourceReadState;adopted?:CapabilitySourceRef}){
  const current=state?.status==='current'?state.ref:state&&'currentRef' in state?state.currentRef:undefined;
  return <section className="knowledge-source-details" data-testid="knowledge-source-status">
    <p><strong>来源身份：</strong>{state?labels[state.status]:'尚未核实来源身份'}</p>
    {state&&'issue' in state&&<p>{state.issue}</p>}
    {!adopted&&<p>这份记录尚未采纳来源身份，读取页面不会自动补齐。</p>}
    {state?.status==='untracked'&&<p>首次采纳只从本次观察开始追踪，不代表此前一直是同一个对象。</p>}
    {state?.status==='retired'&&<p>旧采纳和责任历史仍保留；当前同名对象不会自动接替原对象。</p>}
    <details><summary>查看来源依据</summary>{adopted&&<><h4>已采纳</h4><SourceReference value={adopted}/></>}{current&&<><h4>当前来源</h4><SourceReference value={current}/></>}{state?.status==='pending'&&<p>待核实事务：<code>{state.transitionId}</code></p>}{state?.status==='untracked'&&<p>本次观察：<code>{state.source.sourceId}</code><br/>知识版本：<code>{state.observation.knowledgeRevision}</code></p>}<small>只能追踪已记录的受控变化，无法证明未留下事件的离线同字节删除重建。</small></details>
  </section>;
}

/** 预览的 expectedRef 只是版本预期；未追踪对象在真正提交后才有新代次。 */
export function KnowledgeSourceSelection({selection}:{selection?:SourceSelection}){
  if(!selection)return null;
  return <section className="knowledge-source-details" data-testid="knowledge-source-selection"><strong>本次明确采纳的来源</strong>{selection.kind==='builtin'?<SourceReference value={selection.ref}/>:selection.expectedRef?<SourceReference value={selection.expectedRef}/>:<p><code>{selection.source.sourceId}</code> 尚未追踪；保存时建立本次观察的起点。</p>}<p>只更新本次选择的来源采纳，不迁移旧任务或启动执行。</p></section>;
}
