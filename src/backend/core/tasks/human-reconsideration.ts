/**
 * 作用定位：比较原人工意见与当前等待的真实预览，给出逐项差异和明确重新决定资格。
 * 设计原因：同名人工项或相同文件字节不足以继承接受；等待变化、原来源、最新意见和当前选择分别表达。
 * 职责边界：纯函数只比较可信输入，不读日志或文件，不签署批准；新决定仍须当前完整依据与显式提交。
 */
import {isDeepStrictEqual as equal} from 'node:util';
import {humanReconsiderationSchema,type HumanDecisionRecord,type HumanDecisionPreview,type HumanReconsideration,type HumanDecisionCandidateProof} from './human-decisions';

const order=<T extends {taskId:string}>(items:readonly T[])=>[...items].sort((a,b)=>a.taskId<b.taskId?-1:a.taskId>b.taskId?1:0);
function identity(candidate:HumanDecisionCandidateProof){const {selected:_selected,selectedManifest:_manifest,...value}=candidate;return {taskId:value.taskId,taskRevision:value.taskRevision,runId:value.runId,resultId:value.resultId,planRevision:value.planRevision,logHash:value.logHash,evidenceToolCallIds:[...value.evidenceToolCallIds].sort()}}
function selection(candidate:HumanDecisionCandidateProof){return {taskId:candidate.taskId,...(candidate.selected?{selected:{...candidate.selected,files:candidate.selected.files.map(({relativePath,expected})=>({relativePath,expected})).sort((a,b)=>a.relativePath<b.relativePath?-1:a.relativePath>b.relativePath?1:0)}}:{}),...(candidate.selectedManifest?{manifest:candidate.selectedManifest.manifest}:{})}}
/** 原日志是否可信必须由服务实际读取；当前未选文件时只显示无法核实，不自动沿用旧选择或读取。 */
export function compareHumanReconsideration(records:readonly HumanDecisionRecord[],input:{criterionId:string;reconsidersDecisionId:string;waitId?:string},current:Pick<HumanDecisionPreview,'source'|'candidates'|'allowedDecisions'>,originalVerified:boolean):HumanReconsideration{
  const prior=records.find(r=>r.decisionId===input.reconsidersDecisionId&&r.criterionId===input.criterionId),latest=records.filter(r=>r.criterionId===input.criterionId).at(-1),waitId=current.source?.waitId??input.waitId;
  const checks:HumanReconsideration['checks']=[],add=(key:HumanReconsideration['checks'][number]['key'],state:HumanReconsideration['checks'][number]['state'],message:string)=>checks.push({key,state,message});
  const cross=!!prior&&!!waitId&&prior.proof.source.waitId!==waitId,newest=!!prior&&latest?.decisionId===prior.decisionId;
  add('source',prior&&originalVerified?'same':'unverifiable',prior&&originalVerified?'原意见及原主/成员日志已核实':'原意见或原日志无法核实，不能据此关联新决定');
  add('latest',!prior?'unverifiable':newest?'same':'changed',newest?'仍是该人工项最新的已保存意见':'原意见不存在或已被更新意见取代，请查看最新记录');
  add('waiting',!prior||!waitId?'unverifiable':cross?'changed':'same',cross?'等待已变化；即使证据一致，也必须重新选择并明确提交':'未确认新的等待；同一等待继续使用当前决定入口');
  for(const [key,same,yes,no] of [
    ['criterion',prior&&current.source&&equal(prior.proof.source.criterion,current.source.criterion),'人工验收项原文一致','人工验收项已变化，旧意见不能解释为对新要求的批准'],
    ['knowledge',prior&&current.source&&prior.proof.source.knowledgeRevision===current.source.knowledgeRevision,'知识版本一致','知识版本已变化，须按当前依据重新决定'],
    ['candidates',prior&&equal(order(prior.proof.candidates).map(identity),order(current.candidates).map(identity)),'全部候选、原运行及日志身份一致','候选、运行、版本或日志依据已变化'],
  ] as const)add(key,!prior||!current.source?'unverifiable':same?'same':'changed',!prior||!current.source?'当前'+(key==='criterion'?'人工项':key==='knowledge'?'知识':'候选')+'无法核实':same?yes:no);
  const selected=current.candidates.length>0&&current.candidates.every(c=>c.selected||c.selectedManifest),priorSelected=!!prior&&prior.proof.candidates.every(c=>c.selected||c.selectedManifest),sameSelection=priorSelected&&selected&&equal(order(prior!.proof.candidates).map(selection),order(current.candidates).map(selection));
  add('selection',!selected||!priorSelected?'unverifiable':sameSelection?'same':'changed',!selected?'请明确选择当前候选的产物后重新核实':!priorSelected?'原意见未完整选择产物，不能认定新旧成果一致':sameSelection?'明确选择的原基线/完整清单及冻结范围一致':'所选产物身份或范围已变化，需对新成果重新决定');
  const changed=current.candidates.some(c=>c.selectedManifest?.state==='changed'||c.selected?.files.some(file=>file.state==='changed'||file.state==='missing')),matches=selected&&current.allowedDecisions.includes('accept')&&current.candidates.every(c=>c.selectedManifest?c.selectedManifest.state==='matches':!c.selected?.invalidated&&!!c.selected?.files.length&&c.selected.files.every(file=>file.state==='matches'));
  add('artifacts',changed?'changed':matches?'same':'unverifiable',changed?'当前产物内容、存在状态或完整集合已变化':matches?'当前全部已选产物及必验文件均匹配原依据':'当前产物未选择、无法核实或程序验证条件不满足');
  const comparable=checks.filter(c=>c.key!=='waiting'),status:HumanReconsideration['status']=prior&&!newest?'superseded':prior&&waitId&&!cross?'same_wait':!originalVerified||!current.source?'unverifiable':comparable.some(c=>c.state==='changed')?'changed':comparable.some(c=>c.state==='unverifiable')?'unverifiable':'evidence_matches';
  return humanReconsiderationSchema.parse({decisionId:input.reconsidersDecisionId,...(prior?{previousWaitId:prior.proof.source.waitId}:{}),...(waitId?{currentWaitId:waitId}:{}),status,canReconsider:!!(originalVerified&&newest&&cross&&current.source&&current.allowedDecisions.length),checks});
}
