/**
 * 作用定位：模块绑定源码浏览的纯数据与请求契约，由工作区业务拥有。
 * 设计原因：客户端提交模块和既有来源，不取得任意绝对路径读取能力；目录按页、正文按字节有界。
 */
import {z} from 'zod';
const id=z.string().min(1).max(2048);
const identity={workspaceId:id,instanceId:id,revision:id,moduleId:id,source:id,path:z.string().max(2048).default('')};
export const sourceDirectoryInput=z.object({...identity,offset:z.number().int().min(0).max(1000000).default(0)}).strict();
export const sourceFileInput=z.object(identity).strict();
/** source 是模块声明的工程相对目录；path 相对 source，空值为目录根；revision 是知识版本，不是文件内容版本。 */
export type SourceTarget=z.input<typeof sourceFileInput>;
export interface SourceEntry {name:string;path:string;kind:'directory'|'file'}
/** offset 为本次目录枚举的原始位置；目录变化需刷新，不能当作持久文件身份。 */
export interface SourceDirectory {entries:SourceEntry[];nextOffset?:number}
export type SourceFile={kind:'text';text:string;bytes:number}|{kind:'unsupported';reason:string;bytes:number};
