/**
 * 剪贴板图片 source 是独立 clipboard URI，文件路径 source 是核实后的真实路径；图片字节仅在预览返回，不进入标签元数据。
 * 作用定位：对话附件、执行权限和待审批请求的跨进程契约。
 * 设计原因：附件正文和来源证明由主进程快照保存，界面只传身份；资源资料仅为只读参考，不授予安装或执行权限。
 */
export type {ChatPermission,ChatApproval} from '../../backend/core/brain/types';
export interface ChatAttachment {id:string;kind:'file'|'folder'|'link'|'web'|'connector'|'repository_resource';name:string;source:string;note?:string}
/** 图片仅来自当前工作区已保存快照；禁止 SVG/HTML 与任意预览 URL。 */
export interface ChatAttachmentPreview {name:string;source:string;note?:string;text:string;image?:{mimeType:'image/png'|'image/jpeg'|'image/gif'|'image/webp';data:string}}
/** 只识别整个剪贴板为绝对路径列表的情况；普通句子、相对路径和 URL 保持文本，不猜测用户意图。 */
export function pastedLocalPaths(text:string):string[]|undefined {
  if(!text.trim()||text.length>32768*12||text.includes('\0'))return;
  const lines=text.trim().split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
  if(!lines.length||lines.length>12)return;
  const paths=lines.map(line=>/^(["']).*\1$/.test(line)?line.slice(1,-1):line);
  if(paths.every(value=>/^(?:[a-z]:[\\/]|\/(?!\/)|file:\/\/\/)/i.test(value)&&value.length<=32768))return paths;
}
/** 此资料导入协议不包含正文、凭据或来源证明；本地路径/剪贴板图片分别使用受限专用入口。 */
export type ChatMaterialImport={kind:'link'|'web';value:string}|{kind:'repository_resource';connectorId:string;connectionId:string;expectedRevision:string;resourceId:string};
