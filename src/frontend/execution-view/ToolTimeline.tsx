/**
 * 明确拒绝且没有放行/开始事件时展示可读原因并隐藏副作用操作；旧校验 JSON 只投影不改日志。
 * 作用定位：把工具申请、授权、运行、输出及完成记录合并成可展开的执行时间线。
 * 设计原因：计量遥测只在输入框状态区显示，不重复插入工具轨道；采用 Cindy 的工具生命周期展示方式，避免每个事件显示一份重复 JSON；
 * 动作名称与实时预览共用，原始结果与真实回执分别保留；仓库范围只取运行授权或回执。主命令核实按原运行/调用独立展示，不覆盖原失败或触发重试。
 * 失败提示：展示运行记录中的下一步；熔断说明使用真实 message，不渲染 undefined，不自动查询或重试。
 * 控制边界：仅消费运行投影和调用方提供的操作插槽，不导入页面状态、不查询或启动恢复控制器。
 */
import {toolLabel} from './tool-labels';
import type {ReactNode} from 'react';
import type {RunSummary} from '../../bridge/contracts/execution';
import {RepositoryScopeDetails} from '../components/RepositoryScopeDetails';
import {knowledgeToolView} from './knowledge-tool-view';
import {rejectedToolView} from './tool-failure-view';
import './knowledge-tool-view.css';
const states:Record<string,string>={'tool.proposed':'等待授权','tool.allowed':'准备执行','tool.started':'执行中','tool.updated':'执行中','tool.finished':'已完成','tool.denied':'已拒绝'};
/** 优先呈现工具真实文本输出；完整协议证据另行折叠保留。 */
function outputText(result:unknown):string{
  if(typeof result==='string')return result;
  if(result&&typeof result==='object'&&'content' in result&&Array.isArray(result.content)){
    const text=result.content.filter(x=>x?.type==='text'&&typeof x.text==='string').map(x=>x.text).join('\n');if(text)return text;
  }
  return JSON.stringify(result,null,2);
}
/** 单调用模式只筛选原日志，不混入其他调用或全局状态；展开不执行工具。 */
export function ToolTimeline({run,renderControls,toolCallId}:{run:RunSummary;renderControls?:(call:{id:string;name:string;attention:boolean})=>ReactNode;toolCallId?:string}){
  const calls=new Map<string,{name:string;state:string;input:unknown;result?:unknown;error?:boolean;finished?:boolean;scope?:unknown;receipt?:unknown;nextStep?:string;denied?:boolean;allowed?:boolean}>();
  for(const e of run.events){if(!e.type.startsWith('tool.')||toolCallId!==undefined&&e.data.id!==toolCallId)continue;const id=String(e.data.id);const call=calls.get(id)||{name:String(e.data.name||'工具'),state:'',input:{}};
    call.state=states[e.type]||e.type;if(e.data.input)call.input=e.data.input;
    if(e.type==='tool.allowed'||e.type==='tool.denied')call.scope=e.data.scope;
    if(e.data.receipt&&typeof e.data.receipt==='object'&&'scope' in e.data.receipt){call.receipt=e.data.receipt;call.scope=e.data.receipt.scope}
    if(e.data.outcome&&typeof e.data.outcome==='object'&&'nextStep' in e.data.outcome&&typeof e.data.outcome.nextStep==='string')call.nextStep=e.data.outcome.nextStep;
    if(e.data.result!==undefined)call.result=e.data.result;
    if(e.data.reason)call.result=e.data.reason;
    if(e.type==='tool.denied')call.denied=true;
    if(['tool.allowed','tool.started','tool.updated'].includes(e.type))call.allowed=true;
    call.error=e.type==='tool.denied'||e.data.isError===true;
    call.finished=e.type==='tool.finished';
    if(call.error&&e.type==='tool.finished')call.state='执行失败';calls.set(id,call);
  }
  return <div className="chat-activity">{[...calls].map(([id,c])=>{
    // 只信原事件中的拒绝且没有放行/开始记录；执行后的失败仍保留核实入口。
    const notExecuted=c.denied&&!c.allowed,rejection=notExecuted?rejectedToolView(c.result):undefined;
    const knowledge=c.finished&&!c.error?knowledgeToolView(c.name,c.result,run.task?.workspaceId??''):undefined;
    const invalid=knowledge?.kind==='preview'&&!knowledge.validation.structural;
    const attention=!!c.error||run.status!=='running'&&(!c.finished||c.result===undefined);
    const label=rejection?.invalidInput?'参数待补充或修正':invalid?'校验未通过':knowledge?.kind==='committed'?'知识写入已完成':attention&&!c.error?'结果未核实':c.state;
    const input=c.input as Record<string,unknown>,target=String(input.command||input.path||input.file_path||input.connectorId||input.agentId||(Array.isArray(input.moduleIds)?input.moduleIds.join(', '):''));
    return <details className={'chat-tool'+(c.error?' failed':invalid?' validation-warning':'')} key={id} data-tool-call-id={id} open={attention||undefined}>
      <summary title={c.name+' '+target}><b>{toolLabel(c.name)}</b><code className="tool-target">{target}</code><span>{label}</span></summary>
      {knowledge?.kind==='preview'&&knowledge.validation.issues.length>0&&<section className="knowledge-validation" aria-label="知识校验问题"><strong>{invalid?'校验未通过':'校验提醒'} · {knowledge.validation.issues.length} 项</strong><ul>{knowledge.validation.issues.map((issue,index)=><li key={index}><code>{issue.path}</code> [{issue.code}] {issue.message}</li>)}</ul></section>}
      {knowledge?.kind==='committed'&&<div className="knowledge-commit"><strong>知识写入已完成</strong><p>已通过结构校验并提交 {knowledge.receipt.changed.length} 个文件；业务目标与验收状态单独记录。</p><p>事务 <code>{knowledge.receipt.requestId}</code> · 知识版本 <code>{knowledge.receipt.revision}</code></p></div>}
      {rejection?<p role="status">{rejection.message}</p>:attention&&c.nextStep&&<p role="status">{c.nextStep}</p>}
      <RepositoryScopeDetails scope={c.scope}/><label>参数</label><pre>{JSON.stringify(c.input,null,2)}</pre>
      {!rejection&&c.result!==undefined&&<><label>执行结果</label><pre>{outputText(c.result)}</pre>{typeof c.result==='object'&&<details className="tool-raw-evidence"><summary>原始执行证据</summary><pre>{JSON.stringify(c.result,null,2)}</pre></details>}</>}
      {!rejection?.invalidInput&&c.receipt!==undefined&&<details className="tool-raw-evidence"><summary>运行回执</summary><pre>{JSON.stringify(c.receipt,null,2)}</pre></details>}
      {!notExecuted&&renderControls?.({id,name:c.name,attention})}
    </details>;
  })}{toolCallId===undefined&&<>{!calls.size&&<p>本轮暂无工具调用</p>}{run.events.filter(e=>e.type==='engine.status'&&!e.data.metric).map(e=><p key={e.seq} className="chat-engine-status">{String(e.data.label??e.data.message??e.data.state??'运行状态已更新')}</p>)}</>}</div>;
}
