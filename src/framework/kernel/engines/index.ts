/**
 * 作用定位：官方引擎目录、兼容规则和运行选型的便携公共入口。
 * 设计原因：规则消费者与 View 不加载 SDK、凭据服务或具体 Loop；服务装配使用独立 service 入口。
 */
export { supportedEngines } from './supported-engines';

export type { LoopEngine, EngineDescriptor } from './supported-engines';

export { loopEngineSchema, engineDescriptor, engineLabel, engineApi, engineSupportsApi, engineModelRequirement, connectionForEngine, providerSupportsEngine } from './model-selection';

export type { ResolvedEngineModel } from './model';

export { modelRoleSnapshotSchema, modelRolesSelectionSchema, modelRolesSnapshotSchema, modelRolesMatch } from './model-roles';

export type { ModelRolesSelection, ModelRolesSnapshot, ModelRoleDescriptor } from './model-roles';

export { additionalRoleOperations } from './role-operations';


export { modelRoleChoices, engineSelectionAvailable } from './model-choices';

export { engineAdapterProtocol, checkedEngineAdapter, type EngineAdapter } from './adapter';
export type { AgentEngine } from './agent-engine';
