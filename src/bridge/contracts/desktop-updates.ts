/**
 * 作用定位：正式桌面版本、更新日志与手动更新状态的公开 IPC 数据。
 * 设计原因：页面只展示版本和进度，不接收安装路径、执行命令、更新源配置或 GitHub 凭据。
 */
export interface DesktopRelease {
  version:string;tag:string;notes:string;publishedAt:string;
}
/** ready 只表示安装包已下载并校验；只有新进程的 currentVersion 能证明升级完成。 */
export interface DesktopUpdateStatus {
  currentVersion:string;currentNotes:string;enabled:boolean;
  phase:'disabled'|'idle'|'checking'|'current'|'available'|'downloading'|'ready'|'installing';
  release?:DesktopRelease;progress?:number;checkedAt?:string;error?:string;
}
