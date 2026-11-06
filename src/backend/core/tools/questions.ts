/**
 * 作用定位：结构化用户问题的 Schema 和待答快照。
 * 设计原因：工具输入校验及界面展示共用数据形状，但回答本身不授予执行权限。
 */
import {z} from 'zod';
const question=z.object({question:z.string().trim().min(1).max(1000),options:z.array(z.object({label:z.string().trim().min(1).max(200),description:z.string().max(1000).optional()})).min(2).max(6)});
export const questionInput= z.object({questions:z.array(question).min(1).max(3)});
export type QuestionInput=z.infer<typeof questionInput>;
export interface PendingQuestion extends QuestionInput {id:string;taskId:string}
