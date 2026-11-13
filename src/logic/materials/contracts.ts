/**
 * 作用定位：资料快照的附件身份和预览数据契约。
 * 设计原因：业务保存来源与正文，桥接只运输数据；纯类型不加载文件或平台。
 */
export interface ChatAttachment {id:string;kind:'file'|'folder'|'link'|'web'|'connector'|'repository_resource';name:string;source:string;note?:string}
/** 图片仅来自当前工作区已保存快照；禁止 SVG/HTML 与任意预览 URL。 */
export interface ChatAttachmentPreview {name:string;source:string;note?:string;text:string;image?:{mimeType:'image/png'|'image/jpeg'|'image/gif'|'image/webp';data:string}}
