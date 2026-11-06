/**
 * 作用定位：显示当前主会话已经受理、尚待执行名额的调度请求。
 * 设计原因：准入等待与用户补充 waiting 不同；提示仅消费进程票据，不伪造任务状态、运行或恢复操作。
 */
import type {AdmissionTicket} from '../../bridge/contracts/admission';
import './admission.css';
const labels={global_capacity:'等待运行名额',workspace_conflict:'等待工作区占用释放',agent_busy:'等待成员当前运行结束',fairness:'等待先到的任务领取'};
/** 排序仅用于观察；取消仍使用原会话停止入口，不允许界面任意改派或重放票据。 */
export function AdmissionNotice({tickets,error}:{tickets:AdmissionTicket[];error?:string}){
  if(error)return <p className="admission-notice" role="status" data-testid="admission-unavailable">运行配额状态暂时无法同步；上次数据可能已过期。</p>;
  if(!tickets.length)return null;
  const first=[...tickets].sort((a,b)=>a.order-b.order)[0];
  return <div className="admission-notice" role="status" data-testid="admission-waiting" data-reason={first.reason}><strong>{labels[first.reason as keyof typeof labels]??'等待执行资格'}</strong><span>本会话 {tickets.length} 项已受理安排正在等待；名额释放后继续。等待项尚未启动，不占用模型。</span></div>;
}
