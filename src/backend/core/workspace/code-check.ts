/**
 * 作用定位：代码 Workflow 的冻结命令与成功判据，供知识校验、执行和证据重算共用。
 * 设计原因：模型只触发整组检查，不在运行时改命令、目录或通过条件；测试必须报告实际用例数。
 * 职责边界：声明不授予命令权限；源码范围沿用同一 Workflow 的完整 artifactScope。
 */
import {z} from 'zod';
import {artifactScopePathSchema} from './artifact-scope';

export const codeCheckLimits={checks:8,timeoutMs:300000,outputBytes:256*1024,tailBytes:4096} as const;
export const codeCheckRequirementSchema=z.object({
  id:z.string().regex(/^[A-Za-z0-9_-]{1,80}$/),
  purpose:z.string().min(1).max(1000),
  /** node 使用产品当前 Node 运行时；其它名称从宿主 PATH 查找。无 shell 展开。 */
  program:z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/).refine(value=>! /\.(cmd|bat)$/i.test(value),'Windows 批处理须通过明确的解释器及参数运行'),
  args:z.array(z.string().max(4096).refine(value=>!value.includes('\0'))).max(64),
  /** 相对工作区根；点号表示根目录，不能使用绝对路径或父目录。 */
  cwd:z.union([z.literal('.'),artifactScopePathSchema]),
  timeoutMs:z.number().int().min(100).max(codeCheckLimits.timeoutMs),
  success:z.discriminatedUnion('kind',[
    z.object({kind:z.literal('exit-code')}).strict(),
    z.object({kind:z.literal('test-summary-json'),minPassed:z.number().int().min(1).max(1000000)}).strict(),
  ]),
}).strict();
export type CodeCheckRequirement=z.infer<typeof codeCheckRequirementSchema>;
/** 测试适配脚本以独占一行 CBIM_TEST_SUMMARY 后接该 JSON；不从自然语言日志猜测通过。 */
export const codeTestSummarySchema=z.object({passed:z.number().int().nonnegative(),failed:z.number().int().nonnegative(),skipped:z.number().int().nonnegative()}).strict();
