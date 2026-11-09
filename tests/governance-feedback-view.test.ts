import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it} from 'vitest';
import {GovernanceDecisionFeedback,GovernanceDecisionForm,GovernanceResponseDetails} from '../src/frontend/governance/GovernanceFeedback';
import {governanceDecisionFields,governanceDecisionReviewKey,governanceResponsesCurrent,newGovernanceDecisionDraft,type GovernanceSelected} from '../src/frontend/governance/governance-feedback';
import type {ModuleGovernanceDecision} from '../src/bridge/contracts/governance';

const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,digest='a'.repeat(64),time='2026-11-07T08:00:00.000Z';
function selected():GovernanceSelected{
  const reference={decisionId:id(1),proposalId:id(2),basis:digest,decisionRevision:1};
  return {proposal:{proposalId:id(3),workspaceId:'workspace',moduleId:'.cbim/workspace/engine',protectionId:id(4),observationId:id(5),base:{knowledgeRevision:digest,protectionRevision:1,definitionHash:digest,overviewHash:digest},change:{path:'.cbim/workspace/engine/module.md',beforeText:'原文',afterText:'修订正文',beforeHash:digest,afterHash:'b'.repeat(64)},reason:'补充恢复责任',alternatives:['保留原方案'],invariants:['模块边界不变'],rollbackNotes:'通过新提案恢复',basis:digest,createdAt:time,respondsTo:[reference]},decisions:[],applications:[],responseStates:[{reference,state:'current',latestDecisionId:id(1),latestDecisionRevision:1,feedback:{kind:'evidence_request',focus:'rollback',expectedResponse:'说明恢复责任'},comment:'请提供明确的恢复路径'}]};
}
const decision=(s:GovernanceSelected):ModuleGovernanceDecision=>({decisionId:id(9),workspaceId:'workspace',proposalId:s.proposal.proposalId,revision:1,basis:digest,decision:'approve',comment:'确认方案',actor:{kind:'local_desktop',interaction:'explicit_submit'},recordedAt:time});

it('批准不补造回应评价、反馈或理解状态',()=>{
  const s=selected(),fields=governanceDecisionFields(s,newGovernanceDecisionDraft(),'approve',governanceDecisionReviewKey(s));
  expect(fields).not.toHaveProperty('assessments');expect(fields).not.toHaveProperty('feedback');
  expect(renderToStaticMarkup(createElement(GovernanceDecisionFeedback,{decision:decision(s)}))).toBe('');
});
it('只有明确反馈才随暂缓或驳回保存，并要求具体期望',()=>{
  const s=selected(),draft={...newGovernanceDecisionDraft(),includeFeedback:true,comment:'恢复说明不足',revisitCondition:'收到具体责任说明后',expectedResponse:'说明由谁确认恢复结果'};
  const key=governanceDecisionReviewKey(s);
  expect(governanceDecisionFields(s,draft,'defer',key).feedback?.kind).toBe('evidence_request');
  expect(governanceDecisionFields(s,draft,'reject',key).feedback?.kind).toBe('objection');
  expect(()=>governanceDecisionFields(s,draft,'approve',key)).toThrow('不能同时批准');
  expect(()=>governanceDecisionFields(s,{...draft,expectedResponse:' '},'defer',key)).toThrow('期望回应');
});
it('只提交明确选择且有说明的评价，未选项保持未评价',()=>{
  const s=selected(),other={...s.proposal.respondsTo![0],decisionId:id(11),proposalId:id(12)};
  s.proposal.respondsTo!.push(other);s.responseStates!.push({...s.responseStates![0],reference:other,latestDecisionId:other.decisionId});
  const draft=newGovernanceDecisionDraft();draft.assessments[id(1)]={outcome:'addressed',explanation:'现在能定位恢复负责人'};draft.assessments[id(11)]={outcome:'',explanation:'尚未确认'};
  expect(governanceDecisionFields(s,draft,'approve',governanceDecisionReviewKey(s)).assessments).toEqual([{decisionId:id(1),outcome:'addressed',explanation:'现在能定位恢复负责人'}]);
  draft.assessments[id(1)].explanation=' ';
  expect(()=>governanceDecisionFields(s,draft,'approve',governanceDecisionReviewKey(s))).toThrow('具体说明');
});
it('来源被替代使旧确认失效；重新审阅后仍可无评价暂缓，不能批准或评价旧来源',()=>{
  const s=selected(),key=governanceDecisionReviewKey(s),draft={...newGovernanceDecisionDraft(),comment:'等待当前意见的方案',revisitCondition:'来源重新核实'};
  s.responseStates![0]={...s.responseStates![0],state:'superseded',latestDecisionId:id(8),latestDecisionRevision:2};
  expect(governanceResponsesCurrent(s)).toBe(false);
  expect(()=>governanceDecisionFields(s,draft,'defer',key)).toThrow('重新审阅');
  const fresh=governanceDecisionReviewKey(s);expect(governanceDecisionFields(s,draft,'defer',fresh).decision).toBe('defer');
  expect(()=>governanceDecisionFields(s,draft,'approve',fresh)).toThrow('来源意见已被替代');
  draft.assessments[id(1)]={outcome:'disputed',explanation:'只评价了原意见'};
  expect(()=>governanceDecisionFields(s,draft,'reject',fresh)).toThrow('来源意见已被替代');
});
it('新决定或缺失来源状态不能沿用旧勾选，其他提案评价不能混入',()=>{
  const s=selected(),key=governanceDecisionReviewKey(s),draft=newGovernanceDecisionDraft();s.decisions.push(decision(s));
  expect(()=>governanceDecisionFields(s,draft,'approve',key)).toThrow('重新审阅');
  draft.assessments[id(99)]={outcome:'addressed',explanation:'另一方案的评价'};
  expect(()=>governanceDecisionFields(s,draft,'approve',governanceDecisionReviewKey(s))).toThrow('不属于当前提案');
  s.responseStates=undefined;expect(governanceResponsesCurrent(s)).toBe(false);
});
it('初始表单未评价且未确认；过期视图展示具体原意见但不改写历史',()=>{
  const s=selected();let sent=0;
  const html=renderToStaticMarkup(createElement(GovernanceDecisionForm,{selected:s,disabled:false,onSubmit:()=>{sent++}}));
  expect(html).toContain('value="" selected=""');expect(html).not.toContain('checked=""');expect(sent).toBe(0);
  s.responseStates![0]={...s.responseStates![0],state:'superseded',latestDecisionId:id(8),latestDecisionRevision:2};const before=JSON.stringify(s);
  const stale=renderToStaticMarkup(createElement(GovernanceResponseDetails,{selected:s}));
  expect(stale).toContain('来源已被替代');expect(stale).toContain('请提供明确的恢复路径');expect(stale).toContain(id(8));expect(stale).toContain('没有评价就是未评价');expect(JSON.stringify(s)).toBe(before);
});
