/**
 * 作用定位：模型、准入、预算与反馈账号设置的公开 IPC 请求与响应。
 * 设计原因：设置仅改变配置或未来周期默认值，不向页面暴露运行许可或保存凭据。类型不替代身份和权限校验。
 */
import {z} from 'zod';
import {ipcId,noIpcArgs} from './ipc-shapes';
import {type DiscoveredModel} from '../../backend/core/brain/llm/catalog';
import {type LlmSettings,connectionSchema,definition} from '../../backend/core/brain/llm/config';
import {type GitHubFeedbackStatus,githubFeedbackConfigSchema} from '../../backend/core/connectors/github-feedback';
import {type AdmissionPolicy,type AdmissionRead,admissionConfigureSchema,admissionCursorSchema} from '../../backend/core/runtime/admission';
import {type RuntimeRead,type RuntimeSnapshot} from '../../backend/core/runtime/types';
import {type ScopeBudgetPolicy,scopeBudgetPolicySchema} from '../../backend/core/tasks/scope-budget';

export const settingsIpcRequests={
  'runtime.snapshot':noIpcArgs,
  'runtime.read':z.object({cursor:z.object({streamId:ipcId,revision:z.number().int().nonnegative()}).strict().optional()}).strict().optional(),
  'admission.read':z.object({cursor:admissionCursorSchema.optional()}).strict().optional(),
  'admission.settings':noIpcArgs,
  'admission.configure':admissionConfigureSchema,
  'budget.settings':noIpcArgs,
  'budget.configure':scopeBudgetPolicySchema,
  'models.list':noIpcArgs,
  'models.save':z.object({id:z.string().uuid().optional(),profile:definition,apiKey:z.string().max(16000).optional()}).strict(),
  'models.select':z.object({id:ipcId}).strict(),
  'models.remove':z.object({id:ipcId}).strict(),
  'models.test':z.object({id:ipcId,modelId:z.string().optional()}).strict(),
  'models.discover':z.object({id:z.string().uuid().optional(),connection:connectionSchema.strict(),apiKey:z.string().max(16000).optional()}).strict(),
  'models.discoverDetails':z.object({id:z.string().uuid().optional(),connection:connectionSchema.strict(),apiKey:z.string().max(16000).optional()}).strict(),
  'github.feedback.status':noIpcArgs,
  'github.feedback.cancel':noIpcArgs,
  'github.feedback.disconnect':noIpcArgs,
  'github.feedback.begin':githubFeedbackConfigSchema,
  'github.feedback.poll':z.object({flowId:z.string().uuid()}).strict(),
};
export interface SettingsIpcResponses {
  'runtime.snapshot':RuntimeSnapshot;
  'runtime.read':RuntimeRead;
  'admission.read':AdmissionRead;
  'admission.settings':AdmissionPolicy;
  'admission.configure':AdmissionPolicy;
  'budget.settings':ScopeBudgetPolicy;
  'budget.configure':ScopeBudgetPolicy;
  'models.list':LlmSettings;
  'models.save':LlmSettings;
  'models.select':LlmSettings;
  'models.remove':LlmSettings;
  'models.test':{ok:boolean;model:string;latencyMs:number};
  'models.discover':string[];
  'models.discoverDetails':DiscoveredModel[];
  'github.feedback.status':GitHubFeedbackStatus;
  'github.feedback.cancel':GitHubFeedbackStatus;
  'github.feedback.disconnect':GitHubFeedbackStatus;
  'github.feedback.begin':GitHubFeedbackStatus;
  'github.feedback.poll':GitHubFeedbackStatus;
}
