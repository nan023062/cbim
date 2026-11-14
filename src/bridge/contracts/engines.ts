/**
 * 作用定位：界面使用的官方引擎目录和模型兼容预览契约。
 * 设计原因：只公开便携声明与纯规则，隐藏具体 SDK、引擎实例、凭据和配置存储。
 */
export {modelRolesSelectionSchema,modelRoleChoices,engineSelectionAvailable,supportedEngines,loopEngineSchema,engineDescriptor,engineLabel,engineApi,engineSupportsApi,connectionForEngine,providerSupportsEngine} from '../../logic/engines';
export type {LoopEngine,EngineDescriptor,EnginePackageStatus,EnginePackageSettings} from '../../logic/engines';
