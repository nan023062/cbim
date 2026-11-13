/**
 * 排队保留用户发送时的协作模式，与模型和权限分开，队列启动不猜测当前界面选项。
 * 作用定位：待执行用户消息的校验结构与增量同步契约。
 * 设计原因：队列数据与具体磁盘及 UI 解耦，保留发送时模型、权限和附件身份。
 * 引擎与模型一起冻结到排队项；启动时不能按当前界面选型切换另一引擎。
 */
import {z} from 'zod';
import {loopEngineSchema} from '../../models';
const options=z.object({engine:loopEngineSchema.optional(),provider:z.string(),model:z.string(),profileId:z.string().optional(),attachmentIds:z.array(z.string().uuid()).max(12).optional(),permission:z.enum(['read','ask','execute']).optional(),collaborationMode:z.enum(['auto','team']).optional(),allowNativeExecution:z.boolean().optional(),turnTimeoutMs:z.number().optional()});
export const queuedMessageSchema= z.object({id:z.string(),taskId:z.string(),message:z.string(),options,status:z.enum(['pending','starting','paused']),reason:z.string().optional()});
export type QueuedMessage=z.infer<typeof queuedMessageSchema>;
/** 游标只携带版本，不回传消息正文；epoch 区分队列进程重启。 */
export interface QueueCursor {epoch:string;revision:number;items:Record<string,number>}
export interface QueueDelta {epoch:string;revision:number;reset?:boolean;order?:string[];upserts?:{version:number;item:QueuedMessage}[]}
