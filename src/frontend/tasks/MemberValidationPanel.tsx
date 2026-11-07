/**
 * 作用定位：成员任务详情中的只读 JSON 结构验证记录，列出明确条件、文件与当时结论。
 * 设计原因：工具调用成功与专业条件满足分开显示，历史不符合不被后续通过覆盖；未经当前文件复核不能标为业务验收。
 */
import type {RunSummary} from '../../bridge/contracts/execution';
import {memberValidationViews} from './member-validation-state';
import './member-validation.css';

const labels={passed:'当时符合结构',rejected:'当时不符合结构',unconfirmed:'验证结果未确认',stale:'历史验证 · 后续操作已使依据过期'};
/** 没有记录不增加空区块；组件只消费同轮公开事件，不执行验证或补造恢复操作。 */
export function MemberValidationPanel({run}:{run:RunSummary}){
  const rows=memberValidationViews(run);if(!rows.length)return null;
  return <section className="member-validation-panel" aria-label="产物结构验证"><h4>产物结构验证</h4>
    {rows.map(({result,state})=><article className={'member-validation '+state} key={result.validationId} data-validation-id={result.validationId} data-outcome={state} data-validation-outcome={result.outcome}>
      <strong>{labels[state]}</strong>{state==='stale'&&<small>原结论：{labels[result.outcome]}</small>}<p>{result.artifact.relativePath}</p><p>模块 {result.requirement.moduleId} · 条件 {result.requirement.requirementId}</p>
      <small>{result.checkedAt} · {result.artifact.byteLength} 字节</small>
      <details><summary>规则与文件指纹</summary><code>SHA-256 {result.artifact.sha256}</code><code>Schema {result.requirement.schemaHash}</code><code>{result.requirement.workflowId} · {result.requirement.workflowVersion}</code></details>
      {!!result.issues.length&&<ul>{result.issues.map((issue,index)=><li key={index}>{issue.code==='json_invalid'?'JSON 编码或内容无效':'结构条件不满足'} · {issue.instancePath||'/'}{issue.keyword?' · '+issue.keyword:''}</li>)}</ul>}
    </article>)}<p className="member-muted">仅记录校验当时的指定文件字节。交付及主调度还会复核；结构符合不等于业务验收。</p>
  </section>;
}
