/**
 * 作用定位：组合真实文本补充与人工决定接续的共同有序持久历史。
 * 设计原因：两类来源共享输入版本和主轮预算但不能混淆正文；独立组合层避免公开协议相互引用成环。
 */
import {z} from 'zod';
import {scopeContinuationSchema,type ScopeContinuation} from './scope-continuation';
import {scopeHumanContinuationSchema,type ScopeHumanContinuation} from './human-continue';

/** 旧无 kind 记录保持真实文本补充原样，新人工分支没有 input.message。 */
export const scopeContinuationRecordSchema=z.union([scopeContinuationSchema,scopeHumanContinuationSchema]);
export type ScopeContinuationRecord=ScopeContinuation|ScopeHumanContinuation;
/** 可信来源仅由独立显式入口写入，普通补充的 schema 仍拒绝 kind 等额外字段。 */
export function isHumanContinuation(value:ScopeContinuationRecord):value is ScopeHumanContinuation{return 'kind' in value&&value.kind==='human_decisions'}
