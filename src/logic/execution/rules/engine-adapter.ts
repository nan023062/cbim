/**
 * 作用定位：官方领域 Agent Loop 包与执行宿主之间的版本化工厂契约。
 * 设计原因：运行时只认识生命周期与注入端口，厂商 SDK、进程和业务策略由各包实现；新增引擎无需修改生命周期内核。
 * 职责边界：此协议不授权任意包加载，不注册清单，不提供 Application 或模型配置写权限。
 */
import type {AgentEngine,InputImage} from './types';
import type {EngineToolsPort} from './engine-tools';
import type {EngineRuntimePackage} from './engine-runtime';
import type {ResolvedEngineModel} from '../../engines';
import type {RequestBudgetPort} from '../../budget/rules/request-budget';

export const engineAdapterProtocol=1 as const;
/** 可信开发/平台装配的进程启动信息，不来自模型或公开 IPC。 */
export interface EngineProcess {command:string;args:string[];env?:Record<string,string|undefined>}
/** 每次工厂调用获得独立实例；配置已冻结，端口不能绕过 EngineContext 的权限与持久化顺序。 */
export interface EngineAdapterOptions {
  runtime?:EngineRuntimePackage;
  /** 现有 Codex 原生工具依赖；包生命周期迁移后由声明的依赖解析，不能由模型指定。 */
  nativeToolsRuntime?:EngineRuntimePackage;
  process?:EngineProcess;
  provider:string;model:string;agentHome:string;prompt:string;knowledge:EngineToolsPort;
  llm?:ResolvedEngineModel;images?:InputImage[];allowNativeExecution?:boolean;turnTimeoutMs?:number;
  /** 原 run 登记后才可取得端口；不传角色表示 primary，每次请求独立预留与结算。 */
  requestBudget?(role?:string):Promise<RequestBudgetPort|undefined>;
}
/** 发布包导出唯一 engineAdapter；版本由开发者随适配器维护，不从 SDK 的版本推断。 */
export interface EngineAdapter {
  readonly protocol:typeof engineAdapterProtocol;
  readonly id:string;
  readonly version:string;
  create(options:EngineAdapterOptions):AgentEngine;
}

/** 先核身份与协议再取工厂；不执行安装脚本、回退其它引擎或重试加载。 */
export function checkedEngineAdapter(value:unknown,expected:{id:string;version?:string}):EngineAdapter{
  const adapter=value as Partial<EngineAdapter>|null;
  if(!adapter||adapter.protocol!==engineAdapterProtocol||adapter.id!==expected.id||typeof adapter.version!=='string'||!/^\d+\.\d+\.\d+$/.test(adapter.version)||expected.version!==undefined&&adapter.version!==expected.version||typeof adapter.create!=='function')throw Error('引擎包身份、版本或运行协议不兼容');
  return adapter as EngineAdapter;
}
