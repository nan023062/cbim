/**
 * 作用定位：官方引擎包管理的便携状态投影。
 * 设计原因：设置显示版本、依赖和结果，不取得制品路径、凭据或管理服务实例；revision 用于拒绝过时页面的修改。
 */
import type {EngineArtifact} from '../updates/engine-artifacts';
import type {LoopEngine} from './catalog/supported-engines';
export interface EnginePackageStatus {kind:LoopEngine;enabled:boolean;active?:EngineArtifact;candidate?:EngineArtifact;installed:EngineArtifact[];references:number;preparing:boolean;error?:string}
export interface EnginePackageSettings {managed:boolean;revision:number;items:EnginePackageStatus[]}
