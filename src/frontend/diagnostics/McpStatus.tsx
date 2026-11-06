/**
 * 作用定位：工作区 MCP 状态摘要、流量、问题详情和重启入口。
 * 设计原因：将知识错误与服务健康分别展示，避免把校验失败误判为 MCP 离线。
 */
import {useState} from 'react';
import type {WorkspaceView,Snapshot} from '../../bridge/contracts/workspace';
import {McpLogs} from './McpLogs';

import {formatBytes} from './format';
function state(workspace:WorkspaceView){
  const m=workspace.mcp;
  if(workspace.state==='opening')return {label:'启动中',tone:'pending'};
  if(workspace.state==='closing')return {label:'正在停止',tone:'pending'};
  if(['failed','recovery_required','missing'].includes(workspace.state))return {label:'不可用',tone:'error'};
  if(workspace.state!=='running'||!m)return {label:'未启动',tone:'idle'};
  if(m.health==='degraded')return {label:'连接异常',tone:'error'};
  if(m.health!=='online'||!m.checkedAt||Date.now()-Date.parse(m.checkedAt)>15000)return {label:'等待检查',tone:'pending'};
  if(m.inFlight||m.lastActivityAt&&Date.now()-Date.parse(m.lastActivityAt)<5000)return {label:'活跃',tone:'active'};
  return {label:'在线 · 空闲',tone:'online'};
}
function ago(value?:string){if(!value)return '暂无';const seconds=Math.max(0,Math.floor((Date.now()-Date.parse(value))/1000));return seconds<60?`${seconds} 秒前`:seconds<3600?`${Math.floor(seconds/60)} 分钟前`:`${Math.floor(seconds/3600)} 小时前`}

export function McpSummary({workspace}:{workspace:WorkspaceView}){
  const status=state(workspace),m=workspace.mcp;
  return <small className={'mcp-summary '+status.tone} title="MCP 服务视角：↑ 发给宿主，↓ 从宿主接收；最近 5 秒平均速率，不含健康检查流量。"><span>MCP {status.label}</span><span>↑ {formatBytes(m?.sendRate||0)}/s　↓ {formatBytes(m?.receiveRate||0)}/s</span></small>;
}

export function McpPanel({workspace,restart,snapshot,refreshKnowledge}:{workspace:WorkspaceView;restart:()=>Promise<unknown>;snapshot?:Snapshot;refreshKnowledge:()=>Promise<unknown>}){
  const [logsOpen,setLogsOpen]=useState(false);
  const [restarting,setRestarting]=useState(false),status=state(workspace),m=workspace.mcp;
  const disabled=restarting||['opening','closing'].includes(workspace.state);
  return <section className="mcp-panel" aria-label={`${workspace.name} 的 MCP 服务`}>
    <div className="mcp-overview"><span className={'mcp-health '+status.tone}><i/>MCP · {restarting?'正在重启':status.label}</span>
      <span className="mcp-speed" title="服务视角，统计 HTTP 正文；最近 5 秒平均速率，不含心跳和 HTTP 头。">↑ 发出 {formatBytes(m?.sendRate||0)}/s <span>↓ 接收 {formatBytes(m?.receiveRate||0)}/s</span></span>
      <span className="mcp-last">最近活动：{ago(m?.lastActivityAt)}</span>
      <button disabled={disabled} title="仅重启当前工作区：等待提交结束，取消未完成工具任务，重置本实例流量和写入授权。" onClick={async()=>{setRestarting(true);try{await restart()}finally{setRestarting(false)}}}>{disabled?'正在处理…':'重启 MCP'}</button>
    </div>
    <details className="mcp-details"><summary>连接详情{m?.checkedAt?` · ${m.latencyMs} ms`:' · 尚未通过健康检查'}</summary>
      <div className="mcp-detail-grid"><span>检查时间：{ago(m?.checkedAt)}（每 5 秒检查）</span><span>进行中请求：{m?.inFlight||0}</span><span>累计请求：{m?.requests||0} · 错误：{m?.errors||0}</span><span>累计发出：{formatBytes(m?.sentBytes||0)} · 接收：{formatBytes(m?.receivedBytes||0)}</span><span>启动时间：{m?new Date(m.startedAt).toLocaleString():'—'}</span><span>实例：{m?.instanceId||'—'}</span></div>
      <p>界面每 1.2 秒刷新。当前为无状态 HTTP MCP，进行中请求不代表长期在线的宿主数量；心跳不计入流量和最近活动。统计按本次实例累计。</p>
      {(m?.error||workspace.error)&&<p role="alert">{m?.error||workspace.error}</p>}
      <p>重启只影响此工作区；写入授权将关闭，宿主后续请求会重新发现实例。</p>
    </details>
    <details className="mcp-details knowledge-issues"><summary>知识校验：{workspace.knowledgeErrors||0} 条错误 · 查看问题</summary><button onClick={()=>void refreshKnowledge()}>重新检查知识</button><p>知识校验与 MCP 连接状态独立。以下为程序检查结果，未自动修改知识文件。</p>{snapshot?.validation?.issues.filter(i=>i.severity==='error').map((issue,index)=><div className="knowledge-issue" key={index}><b>{issue.code} · {issue.path}</b><p>{issue.message}</p></div>)}{snapshot?.validation?.structural&&<p>当前未发现结构错误。</p>}</details>
    <details className="mcp-details" onToggle={e=>setLogsOpen(e.currentTarget.open)}><summary>MCP 调用日志</summary>{logsOpen&&<McpLogs id={workspace.id}/>}</details>
  </section>;
}
