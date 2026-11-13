/**
 * 作用定位：计算影响观察的事实依据与处置命令，并构造原不可变回执/摘要。
 * 设计原因：时钟和独立处置 CAS 不属于文件事实；hash 算法只有一个后端实现，前端仅消费叶子契约。
 */
import {hash,json} from '../../../core/platform/node/serialization';
import {effectObservationReportSchema,type EffectObservationReport,type EffectDispositionInput,type EffectDispositionRecord,type EffectDispositionReceipt,type EffectDispositionSummary} from './effect-observation';
/** 严格 Schema 固定本协议字段次序，避免构造顺序与唯一 wire 解析后次序不一致；不改变原对象，也不沿用为旧命令重算指纹。 */
export function effectObservationBasis(report:Omit<EffectObservationReport,'basis'>|EffectObservationReport):string{const parsed=effectObservationReportSchema.parse({...report,basis:'basis' in report?report.basis:'0'.repeat(64)});const {checkedAt:_time,dispositionRevision:_revision,basis:_basis,...facts}=parsed;return hash(json(facts))}
/** 新域固定命令前缀；原请求完整次序由 strict 输入 Schema 确定，不重算其它领域旧指纹。 */
export function effectDispositionCommand(input:EffectDispositionInput){return {commandId:'effect-disposition-'+input.commandId,fingerprint:hash(json({operation:'effect.disposition',input}))}}
export function effectDispositionRevision(state:{effectDispositions?:readonly EffectDispositionRecord[]},rootSessionId:string):number{return (state.effectDispositions??[]).filter(x=>x.request.rootSessionId===rootSessionId).at(-1)?.revision??0}
export function effectDispositionReceipt(record:EffectDispositionRecord):EffectDispositionReceipt{return {workspaceId:record.request.workspaceId,rootSessionId:record.request.rootSessionId,record:structuredClone(record)}}
/** 列表仅提供有界摘要；不截断原记录，末尾不保留被切断的 UTF-16 高代理字符。 */
export function summarizeEffectDisposition(record:EffectDispositionRecord):EffectDispositionSummary{const full=record.request.reason,reason=full.slice(0,512).replace(/[\uD800-\uDBFF]$/,'');return {dispositionId:record.dispositionId,revision:record.revision,decision:record.request.decision,reason,reasonTruncated:reason!==full,recordedAt:record.recordedAt,observationBasis:record.observation.basis}}
