/**
 * 作用定位：稳定桌面冷壳向业务入口提供的私有启动契约；不经过渲染 IPC。
 * 设计原因：业务只取得已验证资源路径、受管引擎解析和生命周期回执，不自行改活动版本或选择任意下载来源。
 */
import type {DesktopUpdates} from './desktop-updates';

/** 仅由冷壳构造，所有路径属于已验证的不可变目录；会话和凭据不在这些目录内。 */
export interface DesktopRuntimeHost {
  assetsRoot:string;cacheRoot:string;codeVersion:string;resourceVersion:number;
  resolveEngine(kind:'pi'|'claude-code'|'codex'):Promise<{root:string;version:string;entry:string;identity:string}>;
  /** 退出/安装排空前取消尚在准备的引擎包，避免等到 will-quit 才取消而阻塞工厂关闭。 */
  stopPreparingEngines():void;
  updates(beforeInstall:()=>Promise<void>,enabled:boolean):DesktopUpdates;
  confirm():void;
}
