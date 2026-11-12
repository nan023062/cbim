/**
 * 作用定位：把后端更新快照转换为侧栏图标的版本、进度和点击语义，不持有下载状态。
 * 设计原因：下载百分比到 100 不等于校验就绪；安装资格只认后端 ready，错误与未知进度明确展示；E 首次准备独立显示，不能误认为应用安装就绪。
 */
import {desktopVersionLabel,type DesktopUpdateStatus} from '../../bridge/contracts/desktop-updates';

/** 只有当前快照已确认准备完成且没有在途动作，图标才可提交安装；仍由后端再次核实。 */
export function updateButtonState(status?:DesktopUpdateStatus,pending=false,error=''){
  const verified=!!status?.enabled&&!!status.release&&status.phase==='ready';
  const preparing=status?.enginePreparations?.filter(item=>!item.error)??[],engineOnly=!pending&&!!preparing.length&&!['checking','downloading','ready','installing'].includes(status?.phase??'idle');
  const ready=verified&&!pending;
  const active=pending||engineOnly||!!status&&['checking','downloading','installing'].includes(status.phase);
  const value=engineOnly&&preparing.length===1?preparing[0].progress:status?.phase==='downloading'?status.progress:undefined;
  const progress=ready?100:Number.isFinite(value)?Math.min(99,Math.max(0,value!)):undefined;
  const labels:Record<DesktopUpdateStatus['phase'],string>={
    disabled:'此构建不支持在线更新',idle:'等待自动检查',checking:'正在检查更新',current:'当前已是最新版本',
    available:'更新尚未准备完成，将自动重试',downloading:progress===undefined?'正在准备更新':`正在下载并校验 ${progress}%`,
    ready:'已准备完成 · 点击安装并重启',installing:'正在结束任务并应用更新，请稍候',
  };
  return {ready,active,progress,canInstall:ready&&!pending,
    engines:status?.enginePreparations?.map(item=>`${item.engine} ${item.version}：${item.error??('正在准备运行包'+(Number.isFinite(item.progress)?' '+Math.min(99,Math.max(0,Math.round(item.progress!)))+'%':''))}`)??[],
    current:status?`当前版本 ${desktopVersionLabel(status.currentVersion,status.currentResourceVersion)}`:'正在读取当前版本',
    target:status?.release?`可更新版本 ${desktopVersionLabel(status.release.version,status.release.resourceVersion)}`:'暂无可更新版本',
    description:pending&&verified?'正在提交安装请求，请稍候':status?labels[status.phase]:'正在读取更新状态',error:error||status?.error||''};
}
