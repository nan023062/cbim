/**
 * 作用定位：业务工作区：领域工程与模块注册表、模块知识和仅本模块 Workflow的核心封装。
 * 设计原因：在同一校验快照上提供领域语义，不依赖工作区进程、桌面页面或 MCP。
 */
import path from 'node:path';
import {context,data,content} from '../knowledge/snapshot';
import {parseJson} from '../foundation/json';
import {fail} from '../foundation/errors';
import type {Snapshot} from '../knowledge/types';
/** 实例固定绑定一个快照；刷新知识后由调用方创建新的领域视图。 */
export class BusinessWorkspace {
  constructor(private snapshot:Snapshot){}
  async modules(query=''){
    const s=this.snapshot,index=parseJson(s.validation!.indexes['.cbim/workspace/registry.json']);
    return {...context(s),workspaceRootId:'.cbim/workspace',modules:index.modules.filter((m:any)=>!query||`${m.id} ${m.summary}`.toLowerCase().includes(query.toLowerCase())),roots:s.validation!.tree.roots,indexSource:'current-definitions',persistedIndexMatches:s.files.find(f=>f.path==='.cbim/workspace/registry.json')?.text===s.validation!.indexes['.cbim/workspace/registry.json']};
  }
  async module(id:string){
    const s=this.snapshot;
    if(!Object.hasOwn(s.validation!.tree.nodes,id))fail('OBJECT_NOT_FOUND','Module 不存在或定义未通过校验，请先查询模块注册表与问题清单');
    const definition=data(s,id+'/module.json');
    return {...context(s),id,definition,definitionFile:s.files.find(f=>f.path===id+'/module.json'),overview:content(s,id,definition.overview),workflows:definition.workflows.map((w:any)=>({...w,id:path.posix.dirname(path.posix.join(id,w.reference)),owner:id,inherited:false,content:content(s,id,w.reference)})),workflowScope:'own-only'};
  }
}
