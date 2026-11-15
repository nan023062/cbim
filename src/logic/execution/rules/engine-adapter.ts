/**
 * 作用定位：官方领域 Agent Loop 包与执行宿主之间的版本化工厂契约，创建前核对包身份与模型/历史声明。
 * 设计原因：运行时只认识生命周期与注入端口，厂商 SDK、进程和业务策略由各包实现；新增引擎无需修改生命周期内核。
 * 职责边界：此协议不授权任意包加载，不注册清单，不提供 Application 或模型配置写权限。
 */
import type {AgentEngine,InputImage} from './types';
import type {EngineToolsPort} from './engine-tools';
import type {EngineRuntimePackage} from './engine-runtime';
import type {ResolvedEngineModel,EngineDescriptor} from '../../engines';
import {orderJsonValue} from '../../../core/utility';
import type {RequestBudgetPort} from '../../budget/rules/request-budget';

export const engineAdapterProtocol=1 as const;
/** 可信开发/平台装配的进程启动信息，不来自模型或公开 IPC。 */
export interface EngineProcess {command:string;args:string[];env?:Record<string,string|undefined>}
/** 每次工厂调用获得独立实例；配置已冻结，端口不能绕过 EngineContext 的权限与持久化顺序。 */
export interface EngineAdapterOptions {
  runtime?:EngineRuntimePackage;
  /** 开发测试的原生工具依赖兼容入口；受管运行由 runtime.dependencies 的准确身份解析。 */
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
  /** 此 E 版本编译时的能力声明；正式加载必须与 R 的选型规则匹配，不能将新规则套到旧实现。 */
  readonly descriptor?:EngineDescriptor;
  create(options:EngineAdapterOptions):AgentEngine;
}

/** 先核身份与协议再取工厂；正式加载传入 R 声明以拒绝不匹配的 E，不执行安装脚本、回退或重试。 */
export function checkedEngineAdapter(value:unknown,expected:{id:string;version?:string;descriptor?:EngineDescriptor}):EngineAdapter{
  const adapter=value as Partial<EngineAdapter>|null;
  if(!adapter||adapter.protocol!==engineAdapterProtocol||adapter.id!==expected.id||typeof adapter.version!=='string'||!/^\d+\.\d+\.\d+$/.test(adapter.version)||expected.version!==undefined&&adapter.version!==expected.version||typeof adapter.create!=='function')throw Error('引擎包身份、版本或运行协议不兼容');
  if(expected.descriptor){
    let matches=false;try{matches=!!adapter.descriptor&&descriptorContract(adapter.descriptor)===descriptorContract(expected.descriptor)}catch{/* 损坏声明不是可执行包，不透传原对象或解析细节。 */}
    if(!matches)throw Error('引擎包的模型或历史协议声明与当前应用不匹配，请更新匹配的引擎包；未启动或自动重试');
  }
  return adapter as EngineAdapter;
}

/** 仅比较执行语义；业务介绍、显示名与角色标签更新不强迫更换仍兼容的 E。 */
function descriptorContract(value:EngineDescriptor){
  const policy={id:value.id,storageDirectory:value.storageDirectory,nativeHistoryFormat:value.nativeHistoryFormat,supportedApis:value.supportedApis,fallbackApi:value.fallbackApi,packageDependencies:value.packageDependencies??[],additionalModelRoles:(value.additionalModelRoles??[]).map(({label:_label,...role})=>role)};
  return JSON.stringify(orderJsonValue(policy,{compareKeys:(a,b)=>a<b?-1:a>b?1:0,omitUndefinedProperties:true}));
}
