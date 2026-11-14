/**
 * 作用定位：桌面完整产物面板使用的纯 DTO 与严格结构校验，不导出后端文件或日志读取实现。
 * 设计原因：清单摘要计算和来源核实只留在后端；前端展示声明范围、实际集合、原删除/移动证明及无法核实原因。
 */
export {outputManifestReportSchema,outputManifestQuerySchema} from '../../logic/evidence/rules/output-manifest';
export type {OutputManifestReport,OutputManifestQuery,OutputManifestSnapshot,OutputManifestEntry,OutputManifestRef} from '../../logic/evidence/rules/output-manifest';
