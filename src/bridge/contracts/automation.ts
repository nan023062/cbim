/**
 * 作用定位：自动化桌面的固定请求、运行时校验与公开返回映射。
 * 设计原因：界面只提交当前工作区实例、定义及版本；路径、启动回调、凭据和运行身份由 Main 管理，不能由 IPC 注入。
 */
import {z} from 'zod';
import {automationIdentitySchema,automationSaveSchema,automationCommandSchema,automationToggleSchema,type AutomationState,type AutomationCatalog,type AutomationJob,type AutomationRun} from '../../backend/core/automation/contracts';
export type {AutomationDefinition,AutomationSchedule,AutomationState,AutomationCatalog,AutomationJob,AutomationRun,AutomationRunStatus} from '../../backend/core/automation/contracts';
export const automationActionSchemas={
 'automation.list':automationIdentitySchema,
 'automation.catalog':automationIdentitySchema,
 'automation.save':automationSaveSchema,
 'automation.run':automationCommandSchema,
 'automation.toggle':automationToggleSchema,
 'automation.remove':automationCommandSchema,
} as const;
export type AutomationAction=keyof typeof automationActionSchemas;
export type AutomationActionInput<K extends AutomationAction>=z.infer<(typeof automationActionSchemas)[K]>;
export interface AutomationActionResults {
 'automation.list':AutomationState;
 'automation.catalog':AutomationCatalog;
 'automation.save':AutomationJob;
 'automation.run':AutomationRun;
 'automation.toggle':AutomationState;
 'automation.remove':AutomationState;
}
export const isAutomationAction=(action:string):action is AutomationAction=>Object.hasOwn(automationActionSchemas,action);
