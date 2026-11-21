/**
 * 作用定位：执行引擎目录及模型选型规则的便携公开入口。
 * 设计原因：静态选型规则与运行驱动分离，调用目录不触发供应商进程或 SDK 初始化。
 */
export { supportedEngines, builtInEngines, registerPackageEngines } from './supported-engines';

export type { LoopEngine, EngineDescriptor } from './supported-engines';

export { loopEngineSchema, engineDescriptor, engineLabel, engineApi, engineSupportsApi, engineModelRequirement, connectionForEngine, providerSupportsEngine } from './model-selection';

export { createModelAdapterRegistry, selectExecutionModelLoader, createModelLoader, type ResolvedEngineModel } from './model';

export { modelRoleSnapshotSchema, modelRolesSelectionSchema, modelRolesSnapshotSchema, modelRolesMatch } from './model-roles';

export type { ModelRolesSelection, ModelRolesSnapshot, ModelRoleDescriptor } from './model-roles';

export { additionalRoleOperations } from './role-operations';

export { modelRoleChoices, engineSelectionAvailable } from './model-choices';

export { checkedEngineAdapter, type EngineAdapter } from './adapter';
