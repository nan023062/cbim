/**
 * 作用定位：桌面更新的通信类型和版本展示文本。
 * 设计原因：更新状态由 Logic 拥有，界面格式不进入更新执行服务。
 */
export type {DesktopRelease,DesktopUpdateStatus} from '../../logic/updates/contracts';
/** 同一格式用于图标、详情与诊断；传统单版本安装仍保留原有显示。 */
export function desktopVersionLabel(codeVersion:string,resourceVersion?:number){return resourceVersion===undefined?`v${codeVersion}`:`C ${codeVersion} · R ${resourceVersion}`}
