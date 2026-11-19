/**
 * 作用定位：官方领域 Agent Loop 包与执行宿主之间的版本化工厂契约，创建前核对包身份与模型/历史声明。
 * 设计原因：运行时只认识生命周期与注入端口，厂商 SDK、进程和业务策略由各包实现；新增引擎无需修改生命周期内核。
 * 职责边界：此协议不授权任意包加载，不注册清单，不提供 Application 或模型配置写权限。
 * 算法入口：通过 Core JsonUtils 静态方法复用机制，本文件继续拥有原业务策略。
 */
import type { AgentEngine, InputImage } from './types';

import type { EngineToolsPort } from './engine-tools';

import type { EngineRuntimePackage } from './engine-runtime';

import type { ResolvedEngineModel } from '../../engines';

import { checkedEngineAdapter as checkAdapter, type EngineAdapter as FrameworkAdapter } from '../../engines';

import type { RequestBudgetPort } from '../../budget/rules/request-budget';

import type { EnginePluginModule } from '../../../framework/kernel';
import type { EngineDescriptor } from '../../engines';
export type PublishedEngineAdapter = EnginePluginModule<EngineAdapterOptions, AgentEngine, EngineDescriptor>['engineAdapter'];

export { engineAdapterProtocol } from '../../../framework/kernel';

/** 可信开发/平台装配的进程启动信息，不来自模型或公开 IPC。 */
export interface EngineProcess
{
  command: string;

  args: string[];

  env?: Record<string, string | undefined>
}

/** 每次工厂调用获得独立实例；配置已冻结，端口不能绕过 EngineContext 的权限与持久化顺序。requestBudget 是已发布 protocol=1 的固定入口。 */
export interface EngineAdapterOptions
{
  runtime?: EngineRuntimePackage;

  /** 开发测试的原生工具依赖兼容入口；受管运行由 runtime.dependencies 的准确身份解析。 */
  nativeToolsRuntime?: EngineRuntimePackage;

  process?: EngineProcess;

  provider: string;

  model: string;

  agentHome: string;

  prompt: string;

  knowledge: EngineToolsPort;

  llm?: ResolvedEngineModel;

  modelInstance?: import('../../../framework/kernel').ModelInstance<import('../../../framework/kernel').ModelConfiguration<ResolvedEngineModel>>;

  images?: InputImage[];

  ReadPermission?(): 'read' | 'ask' | 'execute';
  allowNativeExecution?: boolean;

  turnTimeoutMs?: number;

  /** 原 run 登记后才可取得端口；不传角色表示 primary，每次请求独立预留与结算。 */
  requestBudget?(role?: string): Promise<RequestBudgetPort | undefined>;
}

export type EngineAdapter = FrameworkAdapter<EngineAdapterOptions, AgentEngine>;

export const checkedEngineAdapter = checkAdapter<EngineAdapterOptions, AgentEngine>;
