/**
 * 作用定位：成员派发、运行核实与人工处置的公开 IPC 请求与响应，保留历史派发命令的回执查询兼容。
 * 设计原因：scope 与原命令身份由请求明确选择，写入来源仅由桌面闭包注入，服务继续裁决权限与并发。类型不替代身份和权限校验。
 */
import {z} from 'zod';
import {ipcId,questionAnswers} from './ipc-shapes';
import {type ChatApproval} from '../../logic/tools/rules/policy/types';
import {type ArtifactReport,artifactReportInputSchema} from '../../logic/evidence/rules/artifact-baseline';
import {type CommandVerificationReport,commandVerificationInputSchema} from '../../logic/tasks/rules/command-verification';
import {type ControlledFileReport,type FileCompensationPreview,type FileCompensationReceipt,controlledFileReportInputSchema,fileCompensationInputSchema,fileCompensationLookupSchema,fileCompensationPreviewInputSchema} from '../../logic/file-operations/rules/controlled-file-operation';
import {type CreateMemberReceipt,type DispatchReceipt,type OpenGraphReceipt,createMemberInput,dispatchTaskInput,graphIdentityInput,openGraphInput} from '../../logic/tasks/rules/dispatch-commands';
import {type DispatchMessage} from '../../logic/dispatch/rules/dispatch-storage';
import {type EffectDispositionList,type EffectDispositionReceipt,type EffectObservationReport,type EffectRelations,effectDispositionInputSchema,effectDispositionListInputSchema,effectDispositionLookupSchema,effectObservationInputSchema,effectRelationsInputSchema} from '../../logic/tasks/rules/effect-observation';
import {type ExecutionReport,executionReportInputSchema} from '../../logic/tasks/rules/execution-report';
import {type GraphDelta,type GraphSnapshot} from '../../logic/tasks/rules/graph-types';
import {type HumanDecisionHistory,type HumanDecisionPreview,type HumanDecisionReceipt,humanDecisionHistoryInputSchema,humanDecisionLookupSchema,humanDecisionPreviewInputSchema,humanDecisionRequestSchema} from '../../logic/tasks/rules/human-decisions';
import {type IsolatedExecutionReport,isolatedExecutionCleanupReceiptSchema,isolatedExecutionCleanupSchema,isolatedExecutionRunSchema} from '../../logic/file-operations/rules/isolated-execution-recovery';
import {type MemberExecutionView,type MemberStartReceipt,memberAcknowledgeInput,memberMessageInput,memberStartInput,memberTaskInput} from '../../logic/tasks/rules/member-commands';
import {type MemberEventsRead,memberEventsInput} from '../../logic/tasks/rules/member-events';
import {type RequestBudgetReport,requestBudgetQuerySchema} from '../../logic/budget/rules/model-request-budget';
import {type OutputManifestReport,outputManifestQuerySchema} from '../../logic/evidence/rules/output-manifest';
import {type ReplanPreview,replanPreviewInputSchema} from '../../logic/tasks/rules/scope-replan';
import {type ScopeUsageReport,scopeUsageInputSchema} from '../../logic/budget/rules/scope-usage';
import {type DispatchSessionRead,dispatchSessionReadInput} from '../../logic/tasks/rules/scope-view';
import {type TaskOwnerInspectOutput,taskOwnerInspectInputSchema} from '../../logic/team/rules/owner-execution-discovery';
import {type PendingQuestion} from '../../logic/tools/rules/questions';

export const dispatchIpcRequests={
  'dispatch.isolatedExecutionReport':isolatedExecutionRunSchema,
  'dispatch.controlledFileReport':controlledFileReportInputSchema,
  'dispatch.fileCompensationPreview':fileCompensationPreviewInputSchema,
  'dispatch.fileCompensate':fileCompensationInputSchema,
  'dispatch.open':openGraphInput,
  'dispatch.memberCreate':createMemberInput,
  'dispatch.commandReport':commandVerificationInputSchema,
  'dispatch.effectObserve':effectObservationInputSchema,
  'dispatch.effectDispositionList':effectDispositionListInputSchema,
  'dispatch.effectRelations':effectRelationsInputSchema,
  'dispatch.effectDisposition':effectDispositionInputSchema,
  'dispatch.sessionRead':dispatchSessionReadInput,
  'dispatch.scopeUsage':scopeUsageInputSchema,
  'dispatch.requestBudget':requestBudgetQuerySchema,
  'dispatch.executionStart':memberStartInput,
  'dispatch.executionInspect':memberTaskInput,
  'dispatch.executionReport':executionReportInputSchema,
  'dispatch.artifactReport':artifactReportInputSchema,
  'dispatch.manifestReport':outputManifestQuerySchema,
  'dispatch.replans.preview':replanPreviewInputSchema,
  'dispatch.humanPreview':humanDecisionPreviewInputSchema,
  'dispatch.humanHistory':humanDecisionHistoryInputSchema,
  'dispatch.humanDecide':humanDecisionRequestSchema,
  'dispatch.executionEvents':memberEventsInput,
  'dispatch.isolatedExecutionCleanup':isolatedExecutionCleanupSchema,
  'dispatch.fileCompensationReceipt':fileCompensationLookupSchema,
  'dispatch.effectDispositionReceipt':effectDispositionLookupSchema,
  'dispatch.humanReceipt':humanDecisionLookupSchema,
  // 旧命令可能没有 scopeId，必须先让服务查询原回执；新命令仍由服务以 DISPATCH_SCOPE_REQUIRED 拒绝。
  'dispatch.task':dispatchTaskInput.extend({scopeId:ipcId.optional()}).strict(),
  'dispatch.ownerInspect':taskOwnerInspectInputSchema,
  'dispatch.graphSnapshot':z.object({identity:graphIdentityInput}).strict(),
  'dispatch.graphDelta':z.object({identity:graphIdentityInput,cursor:z.object({workspaceId:ipcId,rootSessionId:ipcId,streamId:ipcId,seq:z.number().int().nonnegative()}).strict().optional(),limit:z.number().int().positive().optional()}).strict(),
  'dispatch.executionStop':memberTaskInput,
  'dispatch.messages':memberMessageInput,
  'dispatch.acknowledge':memberAcknowledgeInput,
  'dispatch.approvals':memberTaskInput,
  'dispatch.approve':memberTaskInput.extend({approvalId:ipcId,allow:z.boolean(),allowAll:z.boolean().optional()}).strict(),
  'dispatch.questions':memberTaskInput,
  'dispatch.answerQuestion':memberTaskInput.extend({questionId:ipcId,answers:questionAnswers}).strict(),
};
export interface DispatchIpcResponses {
  'dispatch.isolatedExecutionReport':IsolatedExecutionReport;
  'dispatch.controlledFileReport':ControlledFileReport;
  'dispatch.fileCompensationPreview':FileCompensationPreview;
  'dispatch.fileCompensate':FileCompensationReceipt;
  'dispatch.open':OpenGraphReceipt;
  'dispatch.memberCreate':CreateMemberReceipt;
  'dispatch.commandReport':CommandVerificationReport;
  'dispatch.effectObserve':EffectObservationReport;
  'dispatch.effectDispositionList':EffectDispositionList;
  'dispatch.effectRelations':EffectRelations;
  'dispatch.effectDisposition':EffectDispositionReceipt;
  'dispatch.sessionRead':DispatchSessionRead;
  'dispatch.scopeUsage':ScopeUsageReport;
  'dispatch.requestBudget':RequestBudgetReport;
  'dispatch.executionStart':MemberStartReceipt;
  'dispatch.executionInspect':MemberExecutionView;
  'dispatch.executionReport':ExecutionReport;
  'dispatch.artifactReport':ArtifactReport;
  'dispatch.manifestReport':OutputManifestReport;
  'dispatch.replans.preview':ReplanPreview;
  'dispatch.humanPreview':HumanDecisionPreview;
  'dispatch.humanHistory':HumanDecisionHistory;
  'dispatch.humanDecide':HumanDecisionReceipt;
  'dispatch.executionEvents':MemberEventsRead;
  'dispatch.isolatedExecutionCleanup':z.output<typeof isolatedExecutionCleanupReceiptSchema>;
  'dispatch.fileCompensationReceipt':FileCompensationReceipt|undefined;
  'dispatch.effectDispositionReceipt':EffectDispositionReceipt|undefined;
  'dispatch.humanReceipt':HumanDecisionReceipt|undefined;
  'dispatch.task':DispatchReceipt;
  'dispatch.ownerInspect':TaskOwnerInspectOutput;
  'dispatch.graphSnapshot':GraphSnapshot;
  'dispatch.graphDelta':GraphDelta;
  'dispatch.executionStop':{requested:boolean};
  'dispatch.messages':DispatchMessage[];
  'dispatch.acknowledge':{messageId:string;delivery:'processed'};
  'dispatch.approvals':ChatApproval[];
  'dispatch.approve':void;
  'dispatch.questions':PendingQuestion[];
  'dispatch.answerQuestion':void;
}
