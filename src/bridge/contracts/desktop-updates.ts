/**
 * 作用定位：正式桌面版本、后台预下载进度与用户确认重启安装的公开 IPC 数据。
 * 设计原因：页面只展示版本和进度，不接收安装路径、执行命令、更新源配置或 GitHub 凭据。
 */
export interface DesktopRelease {
  version:string;tag:string;notes:string;publishedAt:string;
  /** 缺省为旧安装器通道；资源版本必须精确匹配 version 所指冷包。 */
  delivery?:'installer'|'resources';resourceVersion?:number;
}
/** ready 表示包已校验、等待用户确认重启（也包括安装失败后重试）；installing 包含排空，须在新进程核实 currentVersion/currentResourceVersion 才能确认实际装载版本。 */
export interface DesktopUpdateStatus {
  currentVersion:string;currentNotes:string;enabled:boolean;
  /** 当前真实装载的 R；旧安装包不伪造资源版本。 */
  currentResourceVersion?:number;
  /** 首次按需准备的引擎包，与 C/R 安装资格独立；不包含路径、凭据或可执行命令。 */
  enginePreparations?:{engine:'pi'|'claude-code'|'codex';version:string;progress?:number;error?:string}[];
  phase:'disabled'|'idle'|'checking'|'current'|'available'|'downloading'|'ready'|'installing';
  release?:DesktopRelease;progress?:number;
  /** 最近一次完成检查的 ISO 时间，包含失败尝试；结果由 phase/error 区分。 */
  checkedAt?:string;error?:string;
}
/** 同一格式用于图标、详情与诊断；传统单版本安装仍保留原有显示。 */
export function desktopVersionLabel(codeVersion:string,resourceVersion?:number){return resourceVersion===undefined?`v${codeVersion}`:`C ${codeVersion} · R ${resourceVersion}`}
