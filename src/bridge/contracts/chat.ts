/**
 * 作用定位：对话附件、执行权限和待审批请求的跨进程契约。
 * 设计原因：附件正文由主进程快照保存，界面只传身份；权限名称必须对应实际工具门控。
 */
export type {ChatPermission,ChatApproval} from '../../backend/core/brain/types';
export interface ChatAttachment {id:string;kind:'file'|'folder'|'link'|'web'|'connector';name:string;source:string;note?:string}
