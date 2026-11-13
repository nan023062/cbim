/**
 * 作用定位：向桌面公开原调用影响观察、明确处置与后续周期关系的纯契约。
 * 设计原因：前端只选择真实来源、检查有界回包，不读取后端文件或保存实现；报告不授予业务验收或原运行恢复权。
 */
export {
  effectObservationInputSchema,effectObservationReportSchema,effectSubjectSchema,sameEffectSubject,
  effectDispositionInputSchema,effectDispositionReceiptSchema,effectDispositionLookupSchema,
  effectDispositionListInputSchema,effectDispositionListSchema,effectRelationsInputSchema,effectRelationsSchema,
} from '../../logic/tasks/rules/effect-observation';
export type {
  EffectSubject,EffectObservationInput,EffectObservationReport,EffectDispositionInput,EffectDispositionReceipt,
  EffectDispositionRecord,EffectDispositionLookup,EffectDispositionList,EffectRelationsInput,EffectRelations,
} from '../../logic/tasks/rules/effect-observation';
