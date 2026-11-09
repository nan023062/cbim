/**
 * 作用定位：把工具申请、授权、运行、输出及完成记录合并成可展开的执行时间线。
 * 设计原因：计量遥测只在输入框状态区显示，不重复插入工具轨道；采用 Cindy 的工具生命周期展示方式，避免每个事件显示一份重复 JSON；
 * 动作名称与实时预览共用，原始结果与真实回执分别保留；仓库范围只取运行授权或回执。主命令核实按原运行/调用独立展示，不覆盖原失败或触发重试。
 * 影响面板只接受真实主来源及会话上下文，按用户点击观察当前影响并关联新核实，不把时间线挂载当作执行授权。
 */
import {toolLabel} from './tool-labels';
import type {RunSummary} from '../../bridge/contracts/execution';
import {RepositoryScopeDetails} from '../components/RepositoryScopeDetails';
import {isVerifiableMainToolName} from '../../bridge/contracts/command-verification';
import {mainCommandSelection} from './command-verification-state';
import {MainCommandVerification} from './CommandVerificationPanel';
import type {ExecutionRecoveryContext} from '../tasks/useExecutionRecovery';
import {EffectObservationPanel} from '../tasks/EffectObservationPanel';
import {effectObservationAnchor} from '../tasks/effect-recovery-state';
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
export function ToolActivity({run,recovery,toolCallId}:{run:RunSummary;recovery?:ExecutionRecoveryContext;toolCallId?:string}){
  const calls=new Map<string,{name:string;state:string;input:unknown;result?:unknown;error?:boolean;scope?:unknown;receipt?:unknown}>();
  for(const e of run.events){if(!e.type.startsWith('tool.')||toolCallId!==undefined&&e.data.id!==toolCallId)continue;const id=String(e.data.id);const call=calls.get(id)||{name:String(e.data.name||'工具'),state:'',input:{}};
    call.state=states[e.type]||e.type;if(e.data.input)call.input=e.data.input;
    if(e.type==='tool.allowed'||e.type==='tool.denied')call.scope=e.data.scope;
    if(e.data.receipt&&typeof e.data.receipt==='object'&&'scope' in e.data.receipt){call.receipt=e.data.receipt;call.scope=e.data.receipt.scope}
    if(e.data.result!==undefined)call.result=e.data.result;
    if(e.data.reason)call.result=e.data.reason;
    call.error=e.type==='tool.denied'||e.data.isError===true;
    if(call.error&&e.type==='tool.finished')call.state='执行失败';calls.set(id,call);
  }
  return <div className="chat-activity">{[...calls].map(([id,c])=>{
    const input=c.input as Record<string,unknown>,target=String(input.command||input.path||input.file_path||input.connectorId||input.agentId||(Array.isArray(input.moduleIds)?input.moduleIds.join(', '):''));
    const mainSelection=mainCommandSelection(run,id,c.name),selection=isVerifiableMainToolName(c.name)?mainSelection:undefined;
    return <details className={'chat-tool'+(c.error?' failed':'')} key={id} data-tool-call-id={id}>
      <summary title={c.name+' '+target}><b>{toolLabel(c.name)}</b><code className="tool-target">{target}</code><span>{run.status!=='running'&&['等待授权','准备执行','执行中'].includes(c.state)?'已中断，需核实':c.state}</span></summary>
      <RepositoryScopeDetails scope={c.scope}/><label>参数</label><pre>{JSON.stringify(c.input,null,2)}</pre>
      {c.result!==undefined&&<><label>执行结果</label><pre>{outputText(c.result)}</pre>{typeof c.result==='object'&&<details className="tool-raw-evidence"><summary>原始执行证据</summary><pre>{JSON.stringify(c.result,null,2)}</pre></details>}</>}
      {c.receipt!==undefined&&<details className="tool-raw-evidence"><summary>运行回执</summary><pre>{JSON.stringify(c.receipt,null,2)}</pre></details>}
      {selection&&<MainCommandVerification selection={selection} latestSeq={run.events.at(-1)?.seq??0}/>}
      {mainSelection&&<EffectObservationPanel identity={{workspaceId:mainSelection.workspaceId,rootSessionId:mainSelection.rootSessionId,subject:{kind:'main_run',runId:run.runId,toolCallIds:[id]}}} anchor={effectObservationAnchor(recovery?.state)} context={recovery}/>}
    </details>;
  })}{toolCallId===undefined&&<>{!calls.size&&<p>本轮暂无工具调用</p>}{run.events.filter(e=>e.type==='engine.status'&&!e.data.metric).map(e=><p key={e.seq} className="chat-engine-status">{String(e.data.label)}</p>)}</>}</div>;
}
