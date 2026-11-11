/**
 * 作用定位：成员派发、运行核实与人工处置的公开 IPC 请求与响应，保留历史派发命令的回执查询兼容。
 * 设计原因：scope 与原命令身份由请求明确选择，写入来源仅由桌面闭包注入，服务继续裁决权限与并发。类型不替代身份和权限校验。
 */
import {z} from 'zod';
import {ipcId,questionAnswers} from './ipc-shapes';
import {type ChatApproval} from '../../backend/core/policy/types';
import {type ArtifactReport,artifactReportInputSchema} from '../../backend/core/tasks/artifact-baseline';
import {type CommandVerificationReport,commandVerificationInputSchema} from '../../backend/core/tasks/command-verification';
import {type ControlledFileReport,type FileCompensationPreview,type FileCompensationReceipt,controlledFileReportInputSchema,fileCompensationInputSchema,fileCompensationLookupSchema,fileCompensationPreviewInputSchema} from '../../backend/core/tasks/controlled-file-operation';
import {type CreateMemberReceipt,type DispatchReceipt,type OpenGraphReceipt,createMemberInput,dispatchTaskInput,graphIdentityInput,openGraphInput} from '../../backend/core/tasks/dispatch-commands';
import {type DispatchMessage} from '../../backend/core/tasks/dispatch-storage';
import {type EffectDispositionList,type EffectDispositionReceipt,type EffectObservationReport,type EffectRelations,effectDispositionInputSchema,effectDispositionListInputSchema,effectDispositionLookupSchema,effectObservationInputSchema,effectRelationsInputSchema} from '../../backend/core/tasks/effect-observation';
import {type ExecutionReport,executionReportInputSchema} from '../../backend/core/tasks/execution-report';
import {type GraphDelta,type GraphSnapshot} from '../../backend/core/tasks/graph-types';
import {type HumanDecisionHistory,type HumanDecisionPreview,type HumanDecisionReceipt,humanDecisionHistoryInputSchema,humanDecisionLookupSchema,humanDecisionPreviewInputSchema,humanDecisionRequestSchema} from '../../backend/core/tasks/human-decisions';
import {type IsolatedExecutionReport,isolatedExecutionCleanupReceiptSchema,isolatedExecutionCleanupSchema,isolatedExecutionRunSchema} from '../../backend/core/tasks/isolated-execution-recovery';
import {type MemberExecutionView,type MemberStartReceipt,memberAcknowledgeInput,memberMessageInput,memberStartInput,memberTaskInput} from '../../backend/core/tasks/member-commands';
import {type MemberEventsRead,memberEventsInput} from '../../backend/core/tasks/member-events';
import {type RequestBudgetReport,requestBudgetQuerySchema} from '../../backend/core/tasks/model-request-budget';
import {type OutputManifestReport,outputManifestQuerySchema} from '../../backend/core/tasks/output-manifest';
import {type ReplanPreview,replanPreviewInputSchema} from '../../backend/core/tasks/scope-replan';
import {type ScopeUsageReport,scopeUsageInputSchema} from '../../backend/core/tasks/scope-usage';
import {type DispatchSessionRead,dispatchSessionReadInput} from '../../backend/core/tasks/scope-view';
import {type TaskOwnerInspectOutput,taskOwnerInspectInputSchema} from '../../backend/core/team/owner-execution-discovery';
import {type PendingQuestion} from '../../backend/core/tools/questions';

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
