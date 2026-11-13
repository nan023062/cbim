/**
 * 作用定位：IPC 外层信封的少量公共输入形状；业务字段继续使用各领域公开协议。
 * 设计原因：操作名与参数必须成对核实，未知字段不能成为隐式授权；这里只检查结构，不创建工作区或执行服务。
 */
import {z} from 'zod';
export const ipcId=z.string().min(1).max(512);
export const noIpcArgs=z.record(z.never()).nullish();
export const workspaceIdArgs=z.object({id:ipcId}).strict();
export const taskIdArgs=workspaceIdArgs.extend({taskId:ipcId}).strict();
export const runIdArgs=taskIdArgs.extend({runId:ipcId}).strict();
export {questionAnswersInputSchema as questionAnswers} from '../../logic/tools/rules/questions';
