/**
 * 作用定位：业务架构节点的模块知识治理面板，展示真实观察、精确提案与反馈来源、独立人工决定及实施结果。
 * 设计原因：观察基线固定到正文和知识版本；批准与写入分开，面板刷新不覆盖草稿，未知请求只能查原回执，避免将旧批准用于新内容。
 * 职责边界：只经可信 IPC 操作知识治理，不启动模型或业务任务；本机点击不冒充认证身份，结构验证不等于架构语义和业务验收。
 */
import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {
  moduleGovernanceListSchema,moduleGovernanceRegisterInputSchema,moduleGovernanceObserveInputSchema,moduleGovernanceProposeInputSchema,
  moduleGovernanceDecideInputSchema,moduleGovernanceApplyInputSchema,moduleGovernanceReceiptSchema,
  type ModuleGovernanceIdentity,type ModuleGovernanceList,type ModuleGovernanceObservation,type ModuleGovernanceReceipt,
} from '../../bridge/contracts/governance';
import {createGovernancePendingStore,checkedGovernanceReceipt,checkedGovernanceUnaccepted,isFirstGovernanceRejection,type GovernancePending} from './governance-pending';
import {GovernanceOrigin} from './GovernanceOrigin';
import {GovernanceDecisionFeedback,GovernanceDecisionForm,GovernanceResponseDetails} from './GovernanceFeedback';
import {governanceResponsesCurrent} from './governance-feedback';
import './module-governance.css';

const decisions={approve:'批准',reject:'驳回',defer:'暂缓'} as const;
const applicationLabels:Record<string,string>={committed:'知识变更已提交并核实',pending:'实施结果待核实',not_applied:'原意图未提交知识',rolled_back:'原知识事务已回滚',recovery_required:'原知识事务需要人工恢复'};
const inputs={register:moduleGovernanceRegisterInputSchema,observe:moduleGovernanceObserveInputSchema,propose:moduleGovernanceProposeInputSchema,decide:moduleGovernanceDecideInputSchema,apply:moduleGovernanceApplyInputSchema};
const lines=(value:string)=>value.split('\n').map(v=>v.trim()).filter(Boolean);
const message=(error:unknown)=>error instanceof Error?error.message:String(error);
interface Props{identity:ModuleGovernanceIdentity;moduleId:string;onClose():void;onApplied?():Promise<void>}

/** 打开时固定工作区实例和模块；查看历史不启动实施，卸载使所有迟到结果失效。 */
export function ModuleGovernancePanel({identity,moduleId,onClose,onApplied}:Props){
  const target=useRef({...identity,moduleId}).current,alive=useRef(true),lock=useRef(false),sequence=useRef(0);
  const store=useRef(createGovernancePendingStore(localStorage)).current;
  const [view,setView]=useState<ModuleGovernanceList>(),[pending,setPending]=useState<GovernancePending>(),[busy,setBusy]=useState(false),[storageError,setStorageError]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [observation,setObservation]=useState<ModuleGovernanceObservation>(),[statement,setStatement]=useState(''),[body,setBody]=useState(''),[reason,setReason]=useState(''),[alternatives,setAlternatives]=useState(''),[invariants,setInvariants]=useState(''),[rollback,setRollback]=useState('');
  const [receipt,setReceipt]=useState<ModuleGovernanceReceipt>();
  /** 仅为新提案草稿选择原意见 ID；不持有批准、冻结证明或自动迁移评价。 */
  const [responseChoices,setResponseChoices]=useState<{decisionId:string;proposalId:string;comment:string}[]>([]);
  const selection=useRef<{proposalId?:string;observationId?:string}>({});
  const selected=view?.selected,proposal=selected?.proposal,latest=selected?.decisions.at(-1);
  const blocked=busy||!!pending||!!storageError||!view;

  async function load(next=selection.current){
    const seq=++sequence.current;
    const result=moduleGovernanceListSchema.parse(await window.cbim.call('governance.list',{...target,...next}));
    if(result.identity.workspaceId!==target.workspaceId||result.identity.instanceId!==target.instanceId||result.moduleId!==target.moduleId||result.selected&&result.selected.proposal.proposalId!==next.proposalId||result.selectedObservation&&result.selectedObservation.observationId!==next.observationId)throw Error('治理视图与当前目标不一致，未显示迟到结果');
    if(alive.current&&seq===sequence.current){selection.current=next;setView(result)}
    return result;
  }
  async function exclusive(action:()=>Promise<void>){
    // 新操作不能沿用上次成功提示；回复丢失时，只表达当前原命令仍待核实。
    if(lock.current)return;lock.current=true;setBusy(true);setError('');setNotice('');
    try{await action()}catch(cause){if(alive.current)setError(message(cause))}finally{lock.current=false;if(alive.current)setBusy(false)}
  }
  useEffect(()=>{
    alive.current=true;
    try{setPending(store.read(target.workspaceId))}catch(cause){setStorageError(message(cause))}
    void exclusive(async()=>{await load()});
    return()=>{alive.current=false;sequence.current++};
  },[]);

  /** 只对完整原回执解除本地待确认；pending 实施仍需继续查原 journal，不新建命令。 */
  async function accept(raw:unknown,original:GovernancePending){
    const checked=checkedGovernanceReceipt(raw,original);if(!alive.current)return;
    setReceipt(checked);
    if(checked.action==='apply'&&checked.record.state==='pending'){setNotice('原实施意图已保存，知识提交尚未确认；请继续查询原回执。');return}
    store.remove(original);setPending(undefined);setNotice(checked.action==='apply'?applicationLabels[checked.record.state]:checked.action==='decide'?'人工决定已记录，尚未实施；批准不会自动写入知识。':'原治理命令已确认。');
    if(original.moduleId!==target.moduleId){setNotice('另一个模块的原治理命令已核实，本面板仍显示当前模块。');await load();return}
    let next=selection.current;
    if(checked.action==='observe'){
      setObservation(checked.record);setBody(checked.record.overview.text);setReason('');setAlternatives('');setInvariants('');setRollback('');
      next={observationId:checked.record.observationId};
    }
    if(checked.action==='propose'){next={proposalId:checked.record.proposalId};setResponseChoices([])}
    if(checked.action==='apply'&&checked.record.state==='committed'){try{await onApplied?.()}finally{await load(next)}}else await load(next);
  }
  async function submit(action:GovernancePending['action'],fields:Record<string,unknown>){
    if(blocked)return;
    await exclusive(async()=>{
      const commandId=crypto.randomUUID(),request=inputs[action].parse({...identity,commandId,...fields});
      const expected:NonNullable<GovernancePending['expected']>={};
      for(const key of ['protectionId','observationId','proposalId','decisionId'] as const)if(typeof fields[key]==='string')expected[key]=fields[key] as string;
      if(typeof fields.expectedBasis==='string')expected.basis=fields.expectedBasis;
      const original:GovernancePending={...target,commandId,action,...(Object.keys(expected).length?{expected}:{})};
      store.save(original);setPending(original);
      // 只处理首次 RPC 明确预受理拒绝；接收回执/刷新发生错误时不能借相同错误码清除记录。
      let result:unknown;
      try{result=await window.cbim.call('governance.'+action,request)}catch(cause){if(alive.current&&isFirstGovernanceRejection(cause)){store.remove(original);setPending(undefined)}throw cause}
      await accept(result,original);
    });
  }
  async function inspectPending(){if(!pending)return;const original=pending;await exclusive(async()=>{const result=await window.cbim.call('governance.receipt',{workspaceId:original.workspaceId,commandId:original.commandId});if(result)await accept(result,original);else setNotice('尚未查到原命令回执，不能推断未受理。原记录继续保留。')})}
  async function releaseUnaccepted(){if(!pending)return;const original=pending;await exclusive(async()=>{checkedGovernanceUnaccepted(await window.cbim.call('governance.unaccepted',{workspaceId:original.workspaceId,instanceId:original.instanceId,commandId:original.commandId,action:original.action}),original);if(!alive.current)return;store.remove(original);setPending(undefined);setNotice('已核实原实例退役且命令未受理，待确认记录已解除。');await load()})}
  async function selectProposal(proposalId:string){await exclusive(async()=>{await load({proposalId})})}
  async function inspectApplication(commandId:string){await exclusive(async()=>{const result=moduleGovernanceReceiptSchema.parse(await window.cbim.call('governance.receipt',{workspaceId:target.workspaceId,commandId}));if(result.commandId!==commandId||result.identity.workspaceId!==target.workspaceId||result.action!=='apply'||result.record.proposalId!==proposal?.proposalId)throw Error('历史实施回执与选定提案不一致');if(alive.current)setReceipt(result)})}

  return createPortal(<div className="modal-backdrop"><section className="modal module-governance" role="dialog" aria-modal="true" aria-label="模块知识治理" data-testid="module-governance-panel">
    <header><div><small>静态业务架构 · 模块知识</small><h2>知识治理</h2><code>{moduleId}</code></div><button disabled={busy} onClick={onClose}>关闭</button></header>
    <p>登记保护范围后，正文修改需经过提案、人工决定和单独实施。这里只验证知识变更；不执行项目业务，也不代替架构语义验收。</p>
    <button disabled={busy} onClick={()=>void exclusive(async()=>{await load()})}>刷新治理状态</button>
    {(error||storageError)&&<p className="error-text" role="alert">{error||storageError}</p>}{notice&&<p role="status">{notice}</p>}
    {pending&&<aside className="governance-pending"><b>原治理操作待确认</b><p>{pending.moduleId} · {pending.action}</p><code>{pending.commandId}</code><p>切换页面不会重发。请查询原回执后继续。</p><button data-testid="governance-query-pending" disabled={busy} onClick={()=>void inspectPending()}>查询原命令回执</button>{pending.instanceId!==identity.instanceId&&<button disabled={busy} onClick={()=>void releaseUnaccepted()}>核实未受理并解除</button>}</aside>}
    {view&&<>
      {!!view.issues.length&&<ul className="governance-issues">{view.issues.map((issue,index)=><li key={index}>{issue.code} · {issue.message}</li>)}</ul>}
      {!view.protection?<section><h3>登记保护范围</h3><p>保护当前模块定义及其 module.md 正文绑定。此版本尚不支持解除、移动或删除保护对象；未登记模块保持原编辑流程。</p><button data-testid="governance-register" disabled={blocked} onClick={()=>void submit('register',{expectedKnowledgeRevision:view.knowledgeRevision,moduleId})}>登记此模块知识保护</button></section>:<>
        <section><h3>保护范围 · 版本 {view.protection.revision}</h3><code>{view.protection.definition.path}</code><code>{view.protection.overview.path}</code><small>本机明确登记，不是账号认证或专业资质声明。</small></section>
        {!!responseChoices.length&&<section data-testid="governance-response-choices"><h4>新提案将回应的意见（{responseChoices.length}/8）</h4><p>已选意见将随下一份新提案保存；请记录观察并编辑修订正文。选择意见本身不会启动模型或改变决定。</p>{responseChoices.map(item=><article key={item.decisionId}><p>{item.comment}</p><code>{item.decisionId}</code><button disabled={blocked} onClick={()=>setResponseChoices(values=>values.filter(value=>value.decisionId!==item.decisionId))}>移除此回应引用</button></article>)}</section>}
        <fieldset disabled={blocked}><legend>记录当前观察</legend><label>问题或变化说明<textarea aria-label="治理观察说明" value={statement} onChange={event=>setStatement(event.target.value)} maxLength={8000}/></label><p>记录当前知识版本、文件指纹与真实结构检查。创建新观察会载入当前正文并开启一份新的提案草稿。</p><button data-testid="governance-observe" disabled={!statement.trim()} onClick={()=>void submit('observe',{protectionId:view.protection!.protectionId,expectedProtectionRevision:view.protection!.revision,expectedKnowledgeRevision:view.knowledgeRevision,statement})}>保存观察并载入正文</button></fieldset>
        {observation&&<fieldset disabled={blocked}><legend>基于观察创建精确提案</legend><small>观察 {observation.observationId} · {observation.validation.structural?'结构检查通过':'结构存在问题'} · 架构仍需 review</small><label>修改后的模块正文<textarea className="governance-body" aria-label="治理提案正文" value={body} onChange={event=>setBody(event.target.value)}/></label><label>修改理由<textarea aria-label="治理修改理由" value={reason} onChange={event=>setReason(event.target.value)} maxLength={8000}/></label><label>替代方案（每行一项）<textarea aria-label="治理替代方案" value={alternatives} onChange={event=>setAlternatives(event.target.value)}/></label><label>保持不变的约束（每行一项）<textarea aria-label="治理不变量" value={invariants} onChange={event=>setInvariants(event.target.value)}/></label><label>恢复说明<textarea aria-label="治理恢复说明" value={rollback} onChange={event=>setRollback(event.target.value)} maxLength={8000}/></label><button data-testid="governance-propose" disabled={body===observation.overview.text||!reason.trim()||!lines(alternatives).length||!lines(invariants).length||!rollback.trim()} onClick={()=>void submit('propose',{protectionId:observation.protectionId,observationId:observation.observationId,expectedProtectionRevision:observation.protectionRevision,expectedKnowledgeRevision:observation.knowledgeRevision,newOverviewText:body,reason,alternatives:lines(alternatives),invariants:lines(invariants),rollbackNotes:rollback,...(responseChoices.length?{respondsToDecisionIds:responseChoices.map(item=>item.decisionId)}:{})})}>保存精确提案</button></fieldset>}
      </>}
      <section aria-label="治理历史"><h3>提案历史</h3>{!view.proposals.length&&<p>暂无提案。</p>}{view.proposals.map(item=><button className="governance-history-item" key={item.proposalId} data-testid="governance-history-proposal" data-proposal-id={item.proposalId} disabled={busy} onClick={()=>void selectProposal(item.proposalId)}><span>{item.reason}</span><small>{new Date(item.createdAt).toLocaleString()} · 决定版本 {item.decisionRevision}</small></button>)}
        <details><summary>观察记录（{view.observations.length}）</summary>{view.observations.map(item=><article key={item.observationId}><p>{item.statement}</p><GovernanceOrigin origin={item.origin}/><code>{item.knowledgeRevision}</code><button disabled={busy} onClick={()=>void exclusive(async()=>{await load({...selection.current,observationId:item.observationId})})}>查看原观察依据</button></article>)}</details>
        {view.selectedObservation&&<details open><summary>原观察依据</summary><p>{view.selectedObservation.statement}</p><GovernanceOrigin origin={view.selectedObservation.origin}/><p>结构：{view.selectedObservation.validation.structural?'通过':'有问题'}；业务验证：未执行</p><pre>{view.selectedObservation.overview.text}</pre></details>}
      </section>
      {proposal&&<section className="governance-proposal" aria-label="精确治理提案"><h3>提案与决定</h3><code>{proposal.proposalId}</code><GovernanceOrigin origin={proposal.origin}/><p>{proposal.reason}</p><details open><summary>逐份核对原文与修改后正文</summary><div className="governance-diff"><div><h4>修改前</h4><pre>{proposal.change.beforeText}</pre></div><div><h4>修改后</h4><pre>{proposal.change.afterText}</pre></div></div></details><p>替代方案：{proposal.alternatives.join('；')}</p><p>不变量：{proposal.invariants.join('；')}</p><p>恢复说明：{proposal.rollbackNotes}</p><code>依据 {proposal.basis}</code>
        <p data-testid="governance-decision-status">当前决定：{latest?decisions[latest.decision]:'尚未决定'}</p>
        {latest&&<GovernanceDecisionFeedback decision={latest}/>}
        {latest?.feedback&&<button data-testid="governance-add-response" disabled={blocked||responseChoices.length>=8||responseChoices.some(item=>item.decisionId===latest.decisionId)} onClick={()=>setResponseChoices(values=>values.length>=8||values.some(item=>item.decisionId===latest.decisionId)?values:[...values,{decisionId:latest.decisionId,proposalId:proposal.proposalId,comment:latest.comment}])}>将此意见加入新提案</button>}
        <GovernanceResponseDetails selected={selected!}/>
        <GovernanceDecisionForm key={proposal.proposalId} selected={selected!} disabled={blocked} onSubmit={fields=>submit('decide',{proposalId:proposal.proposalId,expectedDecisionRevision:latest?.revision??0,expectedBasis:proposal.basis,...fields})}/>
        <p>批准只针对以上依据，不自动实施。实施前还会重核当前知识与最新决定。</p><button className="solid-button" data-testid="governance-apply" disabled={blocked||latest?.decision!=='approve'||!governanceResponsesCurrent(selected!)||!!selected?.applications.some(item=>item.state==='pending'||item.state==='committed')} onClick={()=>void submit('apply',{proposalId:proposal.proposalId,decisionId:latest!.decisionId,expectedBasis:proposal.basis})}>实施已批准的知识变更</button>
        <details><summary>决定记录（{selected!.decisions.length}）</summary>{selected!.decisions.map(item=><article key={item.decisionId}><b>{decisions[item.decision]} · 版本 {item.revision}</b><p>{item.comment||'未填写附加意见'}</p><GovernanceDecisionFeedback decision={item}/>{item.revisitCondition&&<p>复查条件：{item.revisitCondition}</p>}<small>本机明确提交 · {new Date(item.recordedAt).toLocaleString()}</small></article>)}</details>
        <div data-testid="governance-applications">{selected!.applications.map(item=><article key={item.intentId}><b>{applicationLabels[item.state]}</b><code>{item.requestId}</code>{item.state==='committed'&&<p>知识版本 {item.result.revision}；业务验证未执行。</p>}<button data-testid="governance-application-receipt" disabled={busy} onClick={()=>void inspectApplication(item.intentId)}>回查原实施回执</button></article>)}</div>
      </section>}
    </>}
    {receipt&&<details open data-testid="governance-receipt"><summary>原命令回执</summary><p>{receipt.action==='apply'?applicationLabels[receipt.record.state]:'原 '+receipt.action+' 已登记'}</p><code>{receipt.commandId}</code><pre>{JSON.stringify(receipt,null,2)}</pre></details>}
  </section></div>,document.body);
}
