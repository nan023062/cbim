/**
 * 作用定位：以成员身份显示公开消息和工具过程，供主会话成员卡片及任务详情共用。
 * 设计原因：公开结构化步骤与交付候选直接显示，工具细节仍折叠；复用 Markdown 但保留成员署名，私有推理不在此通道展示。
 */
import type {RunSummary} from '../../bridge/contracts/execution';
import {useEffect,useState} from 'react';
import {transcript} from '../conversation/transcript';
import {MarkdownMessage} from '../conversation/MarkdownMessage';
import {WorkStatus} from '../conversation/WorkStatus';
import {MemberProgressSummary} from './MemberProgressSummary';

/**
 * 调用方须传入后端已筛选的公开投影；本组件负责排版，不承担凭据脱敏。
 * 流式 delta 由 transcript 合并，最终 message 替换暂态正文；compact 只缩短展示，不改变事件读取范围。
 */
export function MemberRunTranscript({run,workspaceId,memberName,compact=false,active=true}:{run:RunSummary;workspaceId:string;memberName:string;compact?:boolean;active?:boolean}){
  const [now,setNow]=useState(Date.now());
  useEffect(()=>{if(run.status!=='running'||!active)return;setNow(Date.now());const timer=setInterval(()=>{if(document.visibilityState!=='hidden')setNow(Date.now())},1000);return()=>clearInterval(timer)},[run.status,active]);
  const messages=transcript(run).filter(item=>item.kind==='assistant'||item.kind==='error');
  const shown=compact?messages.slice(-1):messages;
  if(!run.events.length)return <p className="member-muted" role="status">{run.status==='running'?'正在准备成员执行，尚未收到公开运行事件。':'本轮没有可展示的公开运行记录。'}</p>;
  return <div className={'member-run-transcript'+(compact?' compact':'')}>
    <WorkStatus run={run} now={now}/>
    <MemberProgressSummary run={run} compact={compact}/>
    {shown.map(item=><article className={'member-message '+item.kind} key={item.id} aria-label={item.kind==='error'?'成员执行错误':memberName+'的公开输出'}>
      <div className="member-message-label">{item.kind==='error'?'执行错误':memberName}{item.pending&&<span> · 正在输出</span>}</div>
      <MarkdownMessage text={item.text} streaming={item.pending} workspaceId={workspaceId}/>
    </article>)}
    {!shown.length&&<p className="member-muted">{run.status==='running'?'等待成员产生公开回复，可展开工作记录查看工具状态。':'本轮未产生公开回复。'}</p>}
  </div>;
}
