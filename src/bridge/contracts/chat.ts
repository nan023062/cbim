/**
 * 作用定位：对话附件、执行权限和待审批请求的跨进程契约。
 * 设计原因：附件正文和来源证明由主进程快照保存，界面只传身份；资源资料仅为只读参考，不授予安装或执行权限。
 */
export type {ChatPermission,ChatApproval} from '../../backend/core/brain/types';
export interface ChatAttachment {id:string;kind:'file'|'folder'|'link'|'web'|'connector'|'repository_resource';name:string;source:string;note?:string}
/** 显式导入选择，不包含正文、凭据或来源证明；目录和文件必须经原生选择器。 */
export type ChatMaterialImport={kind:'link'|'web';value:string}|{kind:'repository_resource';connectorId:string;connectionId:string;expectedRevision:string;resourceId:string};
