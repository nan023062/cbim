/**
 * 作用定位：正式桌面版本、后台预下载进度与用户确认重启安装的公开 IPC 数据。
 * 设计原因：页面只展示版本和进度，不接收安装路径、执行命令、更新源配置或 GitHub 凭据。
 */
export interface DesktopRelease {
  version:string;tag:string;notes:string;publishedAt:string;
}
/** ready 表示包已校验、等待用户确认重启（也包括安装失败后重试）；installing 包含提示与排空，只有新进程的 currentVersion 能证明升级完成。 */
export interface DesktopUpdateStatus {
  currentVersion:string;currentNotes:string;enabled:boolean;
  phase:'disabled'|'idle'|'checking'|'current'|'available'|'downloading'|'ready'|'installing';
  release?:DesktopRelease;progress?:number;
  /** 最近一次完成检查的 ISO 时间，包含失败尝试；结果由 phase/error 区分。 */
  checkedAt?:string;error?:string;
}
