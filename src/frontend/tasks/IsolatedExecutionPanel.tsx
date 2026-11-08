/**
 * 作用定位：原成员运行的隔离资源显式核实与清理入口。
 * 设计原因：挂载、切换或刷新不自动清理；未知回包先核实原命令，后端持久记录支持重开后的原清理续接。
 * 职责边界：只展示公开事实，不接受路径或 PID，不重跑脚本或改变原任务失败状态。
 */
import {useEffect,useRef,useState} from 'react';
import {isolatedExecutionReportSchema,isolatedExecutionCleanupReceiptSchema,type IsolatedExecutionRun,type IsolatedExecutionReport,type IsolatedExecutionItem,type IsolatedExecutionCleanup} from '../../bridge/contracts/isolated-executions';
const states={active:'原宿主仍在运行',cleanup_available:'原资源已核实，可清理',cleaned:'原资源已清理',unverifiable:'资源尚不可核实'};
const hosts={live:'仍在运行',exited:'已退出',reused:'原宿主已退出，PID 已复用',unknown:'未知'};
const jobs={not_observed:'宿主未退出，不查询 Job',active:'仍有活动进程',empty:'进程树为空',absent:'Job 已释放',unknown:'未知'};
const files={present:'原目录存在',absent:'原目录已不存在',changed:'目录或所有权已改变',unknown:'未知'};
/** identity/instance 改变即卸载旧面板；异步回包还需核当前选择，不能更新新运行。 */
export function IsolatedExecutionPanel({identity,instanceId}:{identity:IsolatedExecutionRun;instanceId?:string}){
  const key=JSON.stringify([identity,instanceId]),current=useRef(key),alive=useRef(true);current.current=key;
  const [report,setReport]=useState<IsolatedExecutionReport>(),[busy,setBusy]=useState(false),[error,setError]=useState(''),[fresh,setFresh]=useState(false),[message,setMessage]=useState('');
  const pending=useRef(new Map<string,IsolatedExecutionCleanup>());
  useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[]);
  const valid=()=>alive.current&&current.current===key;
  const inspect=async()=>{setBusy(true);setFresh(false);setError('');setMessage('');try{const value=isolatedExecutionReportSchema.parse(await window.cbim.call('dispatch.isolatedExecutionReport',identity));if(Object.entries(identity).some(([key,expected])=>value.identity[key as keyof IsolatedExecutionRun]!==expected))throw Error('核实身份不匹配');if(valid()){setReport(value);setFresh(true)}}catch(error){if(valid())setError('核实失败：'+String(error)+'；请重新核实原执行。')}finally{if(valid())setBusy(false)}};
  const cleanup=async(item:IsolatedExecutionItem)=>{if(!instanceId||!fresh||!item.cleanupAllowed||busy)return;
    const input={...identity,instanceId,executionId:item.executionId,basis:item.cleanupBasis??item.basis,commandId:item.cleanupCommandId??pending.current.get(item.executionId)?.commandId??crypto.randomUUID()};pending.current.set(item.executionId,input);
    setBusy(true);setFresh(false);setError('');try{const receipt=isolatedExecutionCleanupReceiptSchema.parse(await window.cbim.call('dispatch.isolatedExecutionCleanup',input));if(receipt.executionId!==input.executionId||receipt.commandId!==input.commandId)throw Error('原清理回执不匹配');if(valid()){pending.current.delete(item.executionId);setReport(undefined);setMessage('原资源清理已完成，原任务结果保持不变。')}}catch(error){if(valid())setError('清理结果尚未确认：'+String(error)+'；请先核实，保留并继续原清理请求。')}finally{if(valid())setBusy(false)}};
  return <section className="execution-report" aria-label="隔离执行资源" data-testid="isolated-execution-panel">
    <header><h4>隔离执行资源</h4><button disabled={busy} onClick={()=>void inspect()} data-testid="isolation-inspect">核实隔离资源</button></header>
    <p className="member-muted">核实只读取原记录与平台事实。清理只回收已确认退出的原资源，不重跑程序或改变原任务结果。</p>
    {message&&<p role="status" data-testid="isolation-cleaned">{message}</p>}{busy&&<p role="status">正在处理原隔离资源…</p>}{error&&<p className="member-error" role="alert">{error}</p>}
    {report&&<><p className="member-muted">核实于 {new Date(report.checkedAt).toLocaleString()}</p>{report.issues.map((issue,i)=><p className="member-warning" key={i}>{issue}</p>)}{!report.items.length&&<p>没有可核实的新协议记录；不能据此判定旧调用未执行。</p>}
      {report.items.map(item=><div className="execution-report-tool" key={item.executionId} data-testid="isolation-item" data-state={item.state}>
        <strong>{states[item.state]}</strong><p>原调用：<code>{item.toolCallId}</code></p><p>宿主：{hosts[item.host]}；{jobs[item.job]}；{files[item.files]}</p>
        {item.issues.map((issue,i)=><p className="member-warning" key={i}>{issue}</p>)}
        {item.cleanupAllowed&&<button data-testid="isolation-cleanup" disabled={busy||!fresh||!instanceId} onClick={()=>void cleanup(item)}>{item.cleanupCommandId||pending.current.has(item.executionId)?'继续原资源清理':'清理已核实的原资源'}</button>}
      </div>)}{!fresh&&<p className="member-warning">请重新核实后操作。</p>}</>}
  </section>;
}
