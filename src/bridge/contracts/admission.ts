/**
 * 作用定位：向界面公开全局并发策略、当前占用及准入等待的可序列化契约。
 * 设计原因：前端只读运行投影并显式修改上限，不持有租约、模型正文或调度回调。
 */
export type {AdmissionPolicy,AdmissionCursor,AdmissionSnapshot,AdmissionRead,AdmissionTicket,AdmissionOccupant} from '../../logic/runtime/rules/admission';
export {admissionPolicySchema,admissionReadSchema} from '../../logic/runtime/rules/admission';
