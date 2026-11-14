/**
 * 目录归属：logic/file-operations/rules/file-operations；受控文件与隔离协议。
 * 作用定位：冻结范围成员的受控读取与固定 Node 执行协议，供 Runtime 和平台共享。
 * 设计原因：只允许模型选择原范围内文件和有界参数；运行身份、预算、执行器及环境均由可信工厂捕获。
 * 职责边界：结果是操作事实，不是专业验收；隔离输出不自动回写原工程。
 */
import {z} from 'zod';
import {executionPathSchema} from '../../workspace/rules/execution-scope';
export const scopedReadToolName='cbim_scoped_read' as const;
export const scopedNodeToolName='cbim_scoped_node' as const;
export const scopedReadInputSchema=z.object({path:executionPathSchema}).strict();
export const scopedNodeInputSchema=z.object({entry:executionPathSchema,files:z.array(executionPathSchema).min(1).max(64),args:z.array(z.string().max(2048).refine(v=>!v.includes('\0'))).max(16),outputs:z.array(executionPathSchema).max(16)}).strict().superRefine((v,c)=>{
  if(!v.files.includes(v.entry)||!/\.(?:js|cjs|mjs)$/.test(v.entry)||new Set(v.files.map(v=>v.toLowerCase())).size!==v.files.length||new Set(v.outputs.map(v=>v.toLowerCase())).size!==v.outputs.length)c.addIssue({code:'custom',message:'入口必须在唯一快照文件内，且为 Node 脚本；输出路径不能重复'});
});
export type ScopedNodeInput=z.infer<typeof scopedNodeInputSchema>;
const fact=z.object({path:executionPathSchema,byteLength:z.number().int().min(0).max(1024*1024),sha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export const scopedReadOutputSchema=z.object({file:fact,encoding:z.literal('utf8'),content:z.string().max(1024*1024),acceptance:z.literal('not_evaluated')}).strict();
export const scopedNodeOutputSchema=z.object({executionId:z.string().uuid(),isolation:z.literal('windows-lpac-registry-read-v1'),status:z.enum(['exited','timed_out','cancelled','output_limit','resource_limit']),exitCode:z.number().int(),stdio:z.string().max(128*1024),runtime:z.object({sha256:fact.shape.sha256,assets:z.array(z.object({name:z.enum(['icudtl.dat','v8_context_snapshot.bin','snapshot_blob.bin']),sha256:fact.shape.sha256}).strict()).max(3)}).strict(),inputs:z.array(fact).max(64),outputs:z.array(fact.extend({base64:z.string().max(1400000)})).max(16),allProcessesExited:z.literal(true),cleanup:z.literal('complete'),acceptance:z.literal('not_evaluated')}).strict();
