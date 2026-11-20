export { supportedEngines, builtInEngines, registerPackageEngines } from './supported-engines';

export type { LoopEngine, EngineDescriptor } from './supported-engines';

export { loopEngineSchema, engineDescriptor, engineLabel, engineApi, engineSupportsApi, engineModelRequirement, connectionForEngine, providerSupportsEngine } from './model-selection';

export { createModelAdapterRegistry, selectExecutionModelLoader, createModelLoader, type ResolvedEngineModel } from './model';

export { modelRoleSnapshotSchema, modelRolesSelectionSchema, modelRolesSnapshotSchema, modelRolesMatch } from './model-roles';

export type { ModelRolesSelection, ModelRolesSnapshot, ModelRoleDescriptor } from './model-roles';

export { additionalRoleOperations } from './role-operations';

export { modelRoleChoices, engineSelectionAvailable } from './model-choices';

export { checkedEngineAdapter, type EngineAdapter } from './adapter';
