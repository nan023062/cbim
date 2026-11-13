/**
 * 网页设置管理浏览器 robots 策略、Brave 开关和加密密钥摘要，不向页面提供任意抓取代理。
 * 作用定位：模型、准入、预算与反馈账号设置的公开 IPC 请求与响应。
 * 设计原因：设置仅改变配置或未来周期默认值，不向页面暴露运行许可或保存凭据。类型不替代身份和权限校验。
 */
import {z} from 'zod';
import {webConfigureInput,type WebSettingsView} from './web';
import {ipcId,noIpcArgs} from './ipc-shapes';
import {type DiscoveredModel} from './models';
import {type LlmSettings,connectionSchema,definition} from './models';
import {type GitHubFeedbackStatus,githubFeedbackConfigSchema} from './github-feedback';
import {type AdmissionPolicy,type AdmissionRead,admissionConfigureSchema,admissionCursorSchema} from '../../logic/runtime/rules/admission';
import {type RuntimeRead,type RuntimeSnapshot} from '../../logic/runtime/rules/types';
import {type ScopeBudgetPolicy,scopeBudgetPolicySchema} from '../../logic/budget/rules/scope-budget';
import {modelActionSchemas,type ModelActionResults} from './model-actions';

export const settingsIpcRequests={
  ...modelActionSchemas,
  'web.settings':noIpcArgs,
  'web.configure':webConfigureInput,
  'runtime.snapshot':noIpcArgs,
  'runtime.read':z.object({cursor:z.object({streamId:ipcId,revision:z.number().int().nonnegative()}).strict().optional()}).strict().optional(),
  'admission.read':z.object({cursor:admissionCursorSchema.optional()}).strict().optional(),
  'admission.settings':noIpcArgs,
  'admission.configure':admissionConfigureSchema,
  'budget.settings':noIpcArgs,
  'budget.configure':scopeBudgetPolicySchema,
  'models.list':noIpcArgs,
  'github.feedback.status':noIpcArgs,
  'github.feedback.cancel':noIpcArgs,
  'github.feedback.disconnect':noIpcArgs,
  'github.feedback.begin':githubFeedbackConfigSchema,
  'github.feedback.poll':z.object({flowId:z.string().uuid()}).strict(),
};
export interface SettingsIpcResponses extends ModelActionResults {
  'web.settings':WebSettingsView;
  'web.configure':WebSettingsView;
  'runtime.snapshot':RuntimeSnapshot;
  'runtime.read':RuntimeRead;
  'admission.read':AdmissionRead;
  'admission.settings':AdmissionPolicy;
  'admission.configure':AdmissionPolicy;
  'budget.settings':ScopeBudgetPolicy;
  'budget.configure':ScopeBudgetPolicy;
  'github.feedback.status':GitHubFeedbackStatus;
  'github.feedback.cancel':GitHubFeedbackStatus;
  'github.feedback.disconnect':GitHubFeedbackStatus;
  'github.feedback.begin':GitHubFeedbackStatus;
  'github.feedback.poll':GitHubFeedbackStatus;
}
