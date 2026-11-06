/**
 * 作用定位：展示 Agent 的结构化问题，以选项卡及最后一项其它输入收集答案。
 * 设计原因：本地选择不触发发送；提交前完整校验，失败保留草稿，明确提交后才继续原任务。
 */
import {useState} from 'react';
import type {PendingQuestion} from '../../bridge/contracts/execution';
import './questions.css';
export function QuestionCard({request,onAnswer}:{request:PendingQuestion;onAnswer:(answers:{option:number|null;other:string}[])=>Promise<void>}){
 const [answers,setAnswers]=useState(request.questions.map(()=>({option:-1 as number|null,other:''}))),[busy,setBusy]=useState(false),[sent,setSent]=useState(false),[error,setError]=useState('');
 const update=(i:number,patch:Partial<typeof answers[number]>)=>setAnswers(old=>old.map((a,n)=>n===i?{...a,...patch}:a));
 return <form className="question-card" onSubmit={async e=>{e.preventDefault();if(busy||sent)return;setBusy(true);setError('');try{await onAnswer(answers);setSent(true)}catch(e:any){setError(e.message)}finally{setBusy(false)}}}>
  {request.questions.map((q,i)=><fieldset key={i} disabled={busy||sent}><legend>{q.question}</legend><div className="question-options">{q.options.map((o,n)=><label className={'question-option'+(answers[i].option===n?' selected':'')} key={n}><input type="radio" name={request.id+'-'+i} checked={answers[i].option===n} onChange={()=>update(i,{option:n})}/><span><b>{o.label}</b>{o.description&&<small>{o.description}</small>}</span></label>)}<label className={'question-option'+(answers[i].option===null?' selected':'')}><input type="radio" name={request.id+'-'+i} checked={answers[i].option===null} onChange={()=>update(i,{option:null})}/><span>其它 / 补充</span></label></div><textarea aria-label={'其它补充 '+(i+1)} placeholder="填写其它想法，或为所选项补充要求…" maxLength={4000} value={answers[i].other} onChange={e=>update(i,{other:e.target.value})}/></fieldset>)}
  {error&&<p role="alert">{error}</p>}<button type="submit" disabled={busy||sent||answers.some(a=>a.option===-1||a.option===null&&!a.other.trim())}>{sent?'已提交':busy?'提交中…':'提交并继续'}</button>
 </form>;
}
