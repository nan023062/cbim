/**
 * 作用定位：查询和筛选当前工作区的 MCP 调用日志。
 * 设计原因：按工作区查询有界元数据日志；关闭面板时停止轮询，旧版本未记录的数据不补造。
 */
import {useEffect,useState} from 'react';
import type {McpCallLog} from '../../bridge/contracts/workspace';
import {formatBytes} from './format';

export function McpLogs({id}:{id:string}){
  const [data,setData]=useState<{entries:McpCallLog[];error?:string;path?:string}>({entries:[]}),[error,setError]=useState(''),[onlyErrors,setOnlyErrors]=useState(false),[query,setQuery]=useState('');
  useEffect(()=>{let alive=true,pending=false;const load=async()=>{if(pending)return;pending=true;try{const result=await window.cbim.call('mcpLogs',{id});if(alive){setData(result);setError('')}}catch(e:any){if(alive)setError(e.message)}finally{pending=false}};void load();const timer=setInterval(()=>void load(),1200);return()=>{alive=false;clearInterval(timer)}},[id]);
  const logs=data.entries.filter(row=>(!onlyErrors||row.result==='error')&&`${row.tool||''} ${row.method||''} ${row.code||''} ${row.message||''}`.toLowerCase().includes(query.toLowerCase()));
  return <div className="mcp-log-view"><div className="mcp-log-controls"><label><input type="checkbox" checked={onlyErrors} onChange={e=>setOnlyErrors(e.target.checked)}/>只看错误</label><input aria-label="筛选 MCP 调用日志" placeholder="工具名、方法或错误码" value={query} onChange={e=>setQuery(e.target.value)}/><span>最近 {data.entries.length} 条 · 每 1.2 秒刷新</span></div>
    {(error||data.error)&&<p role="alert">{error||data.error}</p>}
    {!logs.length&&<p>暂无符合条件的调用日志。旧版本未记录的调用无法补回；健康检查不列入此处。</p>}
    <div className="mcp-log-list">{logs.map(row=><details key={row.id} className={'mcp-log-row '+row.result}><summary><time>{new Date(row.time).toLocaleTimeString()}</time><b>{row.tool||row.method||row.httpMethod}</b><span>{row.result==='error'?row.code||'错误':'成功'} · HTTP {row.status} · {row.durationMs} ms</span></summary><p>{row.message||'请求完成'}</p><p>↑ 发出 {formatBytes(row.sentBytes)} · ↓ 接收 {formatBytes(row.receivedBytes)} · {row.httpMethod} {row.method||''}</p><p>时间：{row.time} · 实例：{row.instanceId}</p><p>记录 ID：{row.id}</p></details>)}</div>
    <p>显示本工作区最近 200 条记录（含重启前实例）。只记录调用元数据与错误摘要，不保存请求参数、知识正文或令牌。</p><p className="mcp-log-path">本机日志：{data.path||'加载中'}（单文件约 2 MiB，保留当前及上一个文件）</p>
  </div>;
}
