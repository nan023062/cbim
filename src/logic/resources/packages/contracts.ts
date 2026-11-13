/**
 * 作用定位：静态知识包发布和导入预览结果。
 * 设计原因：结果属于资源与知识协作，Bridge 仅转接；不加载包存储服务。
 */
import type {ResourceLibrarySnapshot} from '..';
export interface PublishWorkspaceResult {repository:ResourceLibrarySnapshot;resourceId:string;warnings:string[];removedBindings:string[]}
export type ImportWorkspacePreview=import('../../knowledge/rules/types').Preview&{planId:string;kind:'team'|'agent'|'skill'|'architecture';mode:'add'|'replace';targetRoot:string;files:Array<{path:string;action:'create'|'update'|'delete'}>;warnings:string[];removedBindings:string[]};
