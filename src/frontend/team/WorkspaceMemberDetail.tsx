/**
 * 作用定位：只读展示项目岗位的稳定身份、采纳内容与本次核实的外部差异。
 * 设计原因：当前模板和模型配置不能覆盖历史采纳；内容差异与受控来源身份分开显示，不据同字节或启用状态推断运行资格。
 * 已采纳模型同时展示其冻结引擎，未声明的历史快照按 Pi 解释而不改写。
 */
import {engineLabel} from '../../bridge/contracts/models';
import type {WorkspaceMemberDetail} from '../../bridge/contracts/workspace-members';
import {KnowledgeSourceDetails} from '../knowledge/KnowledgeSourceDetails';
const labels={same:'与已采纳一致',changed:'已变化，尚未采纳',missing:'当前来源缺失',invalid:'当前来源无法核实'};
/** 资料按文本展示；这里不联网、不启动模型、不执行 Skill。 */
export function WorkspaceMemberDetailView({detail}:{detail:WorkspaceMemberDetail}){
  const {member,currentDiff}=detail;
  return <section data-testid="workspace-member-detail"><h3>{member.name}</h3><p>{member.position}</p><code>{member.memberId}</code><p>第 {member.revision} 版 · {{active:'已启用',suspended:'已暂停',retired:'已退休'}[member.state]}</p><p>静态能力：{member.adoption.configuration.name} · <code>{member.adoption.configuration.agentId}</code></p><p>已采纳模型：{engineLabel(member.runtimePolicy.snapshot.engine??'pi')} · {member.runtimePolicy.snapshot.name} / {member.runtimePolicy.modelId}</p>
    <div className="workspace-member-diff" data-testid="workspace-member-diff"><p data-diff="capability">能力：{labels[currentDiff.capability.status]}</p><p data-diff="model">模型：{labels[currentDiff.model.status]}</p>{currentDiff.capability.issue&&<p>{currentDiff.capability.issue}</p>}{currentDiff.model.issue&&<p>{currentDiff.model.issue}</p>}<small>核实时间：{new Date(currentDiff.checkedAt).toLocaleString()}；仅核配置，不验证密钥或网络。</small></div>
    <KnowledgeSourceDetails state={detail.sourceStatus} adopted={member.adoption.sourceRef}/>
    <details><summary>岗位适配与已采纳能力</summary><p>{member.adaptation.instructions||'无额外适配说明'}</p>{member.adaptation.references.map(value=><p key={value}><code>{value}</code></p>)}<h4>工作原则</h4><pre>{member.adoption.configuration.principles}</pre><h4>已采纳 Skill · {member.adoption.configuration.effectiveSkills.length}</h4>{member.adoption.configuration.effectiveSkills.map(skill=><details key={skill.skillId}><summary>{skill.skillId} · {skill.inherited?'继承':'自有'}</summary><small>所属：{skill.ownerId}</small><pre>{skill.content}</pre></details>)}</details>
    <details><summary>已采纳模型与版本依据</summary><pre>{JSON.stringify(member.runtimePolicy.snapshot,null,2)}</pre><p>能力指纹：<code>{member.adoption.capabilityHash}</code></p><p>模型指纹：<code>{member.runtimePolicy.configurationHash}</code></p><p>采纳记录：<code>{member.adoption.captureId}</code></p><p>采纳时间：{new Date(member.adoption.capturedAt).toLocaleString()}；不代表来源删除/重建代次。</p></details>
  </section>;
}
