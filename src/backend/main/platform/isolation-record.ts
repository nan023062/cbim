/**
 * 作用定位：Main 私有的隔离资源身份和生命周期协议，连接执行器、可靠记录与核实平台。
 * 设计原因：原路径、宿主创建时间及所有权随机值不能进入公开工具回包；生命周期必须先落盘再启动脚本。
 */
import {z} from 'zod';
import {controlledFileBindingSchema} from '../../core/tasks/controlled-file-operation';
import {scopedExecutionAuthorizationSchema} from '../../core/tasks/isolated-execution-recovery';
const digest=z.string().regex(/^[a-f0-9]{64}$/);
export const isolationProcessSchema=z.object({pid:z.number().int().positive(),created:z.string().regex(/^[0-9]{1,24}$/),session:z.number().int().nonnegative()}).strict();
export type IsolationProcess=z.infer<typeof isolationProcessSchema>;
export const isolationDirectorySchema=z.object({volumeId:z.string().regex(/^[a-f0-9]+$/),fileId:z.string().regex(/^[a-f0-9]{16}$/)}).strict();
export type IsolationDirectory=z.infer<typeof isolationDirectorySchema>;
export const isolationResourceSchema=z.object({executionId:z.string().uuid(),profileName:z.string().regex(/^CBIM\.Isolated\.[a-f0-9-]{36}$/),jobName:z.string().regex(/^Local\\CBIM\.Isolated\.[a-f0-9-]{36}$/),root:z.string().min(1).max(4096),rootIdentity:isolationDirectorySchema,nonce:digest,host:isolationProcessSchema}).strict().refine(value=>value.profileName==='CBIM.Isolated.'+value.executionId&&value.jobName==='Local\\'+value.profileName,'原执行与平台资源名称不一致');
export type IsolationResource=z.infer<typeof isolationResourceSchema>;
export const isolationOriginSchema=scopedExecutionAuthorizationSchema.extend({workspaceInstanceId:z.string().uuid(),scopeId:z.string().min(1).max(100),binding:controlledFileBindingSchema,scopeHash:digest,permission:z.enum(['ask','execute'])}).strict();
export type IsolationOrigin=z.infer<typeof isolationOriginSchema>;
export const isolationRecordSchema=z.object({version:z.literal(1),origin:isolationOriginSchema,resource:isolationResourceSchema,requestHash:digest,createdAt:z.string().datetime()}).strict();
export type IsolationRecord=z.infer<typeof isolationRecordSchema>;
/** 所有回调都在原调用内等待；prepared/started 失败时不得运行脚本，cleaned 失败不得假定可靠完成。 */
export interface IsolationLifecycle {
  prepared(resource:IsolationResource,requestHash:string):Promise<void>;
  started(process:IsolationProcess):Promise<void>;
  settled():Promise<void>;
  cleaned():Promise<void>;
}
