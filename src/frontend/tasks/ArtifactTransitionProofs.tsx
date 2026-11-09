/**
 * 作用定位：成员清单与人工验收共用的删除/移动历史证明视图，展示源、目标及原写前字节依据。
 * 设计原因：文件缺失观察不能解释操作原因；明确原操作和记录顺序，避免将历史证明误读为恢复或再次执行入口。
 */
import type {OutputManifestRef} from '../../bridge/contracts/output-manifest';

/** 仅展示后端已核实的原成功链；当前集合是否一致仍由外层的显式复核结果表达。 */
export function ArtifactTransitionProofs({operations}:{operations:OutputManifestRef['operations']}){
  if(!operations?.length)return null;
  return <section data-testid="artifact-transition-proofs" aria-label="原删除与移动证明">
    <strong>原删除与移动证明 · {operations.length} 项</strong>
    <p>原操作已保存并核实。以下是历史依据，不会再次执行或自动恢复；当前成果仍须复核完整范围。</p>
    {operations.map(value=><article key={value.operationId} data-operation-id={value.operationId}>
      <p>{value.operation.kind==='delete'?<>删除 <code>{value.operation.path}</code></>:<>移动 <code>{value.operation.from}</code> → <code>{value.operation.to}</code></>}</p>
      <p>原文件 {value.before.byteLength.toLocaleString()} 字节 · 操作后源路径缺失{value.operation.kind==='move'?'，目标内容与原文件一致':''}</p>
      <details><summary>查看原记录依据</summary><p>模块 <code>{value.moduleId}</code> · 声明第 {value.operationIndex+1} 项</p><p>写前清单 <code>{value.beforeManifestId}</code></p><p>原文件 SHA-256 <code>{value.before.sha256}</code></p><p>操作后集合 <code>{value.afterManifestHash}</code></p><p>原调用 <code>{value.toolCallId}</code></p><p>记录顺序：授权 {value.allowedSeq} → 准备 {value.preparedSeq} → 执行 {value.executingSeq} → 观察 {value.appliedSeq} → 结束 {value.finishedSeq}</p><p>{new Date(value.appliedAt).toLocaleString()}</p></details>
    </article>)}
  </section>;
}
