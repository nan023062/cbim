/**
 * 作用定位：Core 对象治理：规划 Agent/Module/Skill/Workflow 变更，按计划提交受控事务。
 * 设计原因：静态操作契约由 object-contract 提供，事务通过 KnowledgeWorkspace 契约执行，维护路径、清单及父子引用；Workflow 显式条件在预览前严格解析，提交仍重新走完整知识校验。
 * 模块、岗位和执行权限分别治理；对象预览不再登记真人或生成旧维护确认，已有历史字段只随原对象保留。
 * 静态 Agent 可保存本机默认 runtime 选型，模型身份来自设置；这不改变已登记岗位的采纳或运行权限。
 */
import {objectDataSchemas,type ObjectOperation,type ObjectPreview,type ObjectCommit} from './object-contract';
// 保留原消费入口；浏览器边界直接导入不含事务实现的 object-contract。
export {objectDataSchemas,objectOperation,type ObjectOperation,type ObjectPreview,type ObjectCommit} from './object-contract';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import type {KnowledgeWorkspace} from './ports';
import {fail} from '../foundation/errors';
import {json} from '../foundation/serialization';
import {INDEXES} from './knowledge';
import {parseJson} from '../foundation/json';
import type {ChangeRequest} from './types';
import {parseWorkflowContract} from '../workspace/workflow-contract';
import {knowledgePlanHash,type ResolvedObjectOperation} from './planned-commit';

const pp=path.posix;
export class ObjectCrud {
  constructor(private w:KnowledgeWorkspace){}
  /** 根据语义操作生成完整事务并持久化预览计划；不会自动编造原则或模块正文。提交仍由调用边界检查当前写授权。 */
  async preview(revision:string,operations:ObjectOperation[]):Promise<ObjectPreview>{
    const s=await this.w.snapshot();if(s.revision!==revision)fail('CONFLICT','知识版本已变化，请重新查询');
    const map=new Map(s.files.map(f=>[f.path,f.text])),objects:string[]=[],deletedRoots:string[]=[],resolvedOperations:ResolvedObjectOperation[]=[];
    const get=(p:string)=>{const text=map.get(p);if(text===undefined)fail('OBJECT_NOT_FOUND',`对象不存在：${p}`);return parseJson(text)};
    const set=(p:string,d:any)=>map.set(p,json(d));
    const group=(id:string)=>id==='.cbim/team'||s.validation!.indexes['.cbim/team/registry.json']&&parseJson(s.validation!.indexes['.cbim/team/registry.json']).groups.some((g:any)=>g.id===id);
    for(const op of operations){
      if(op.kind==='workflow'&&op.action!=='delete'&&op.body!==undefined)parseWorkflowContract(op.body);
      let id=op.id||'',owner='',definitionPath='';const data=op.data||{};
      const allowed=Object.keys(objectDataSchemas[op.kind].shape);
      for(const key of Object.keys(data))if(!allowed.includes(key))fail('FIELD',`${op.kind} 不支持修改字段 ${key}；目录与清单由 CBIM 维护`);
      if(op.action==='create'){
        if(op.id||!op.parentId||!op.slug||!/^[a-z][a-z0-9]*(?:[_-][a-z0-9]+)*$/.test(op.slug)||['skills','workflows','references','scripts','assets','archive','node_modules'].includes(op.slug))fail('OBJECT_ID','创建需有效 parentId 和 slug，不接受自定 id');
        owner=op.parentId;
        if(op.kind==='agent'){if(!group(owner)||map.has(owner+'/agent.json'))fail('OWNER','Agent 父节点必须是已知 Team/小组');id=owner+'/'+op.slug}
        else if(op.kind==='module'){if(owner!=='.cbim/workspace')get(owner+'/module.json');if(!owner.startsWith('.cbim/workspace')||op.slug.includes('-'))fail('OWNER','模块必须在 workspace 下并使用 snake_case');id=owner+'/'+op.slug}
        else {if(op.kind==='skill'){if(!group(owner)&&!map.has(owner+'/agent.json'))fail('OWNER','Skill 必须属于已知 Team/小组或 Agent')}else get(owner+'/module.json');id=owner+(op.kind==='skill'?'/skills/':'/workflows/')+op.slug;if(op.kind==='workflow'&&op.slug.includes('-'))fail('OBJECT_ID','Workflow 使用 snake_case')}
        await this.w.paths.knowledge(this.w.entry.path,id+'/__check__');
        if([...map.keys()].some(p=>p.toLowerCase()===id.toLowerCase()||p.toLowerCase().startsWith(id.toLowerCase()+'/')))fail('EXISTS','对象位置已被使用');
        // 同一已核知识专用删除计划可在原位置重建；这不是对现存目录的任意覆盖，生命周期保留有序删除事实。
        if(!deletedRoots.some(root=>id===root||id.startsWith(root+'/')))await this.w.objects.assertAbsent(id);
        if(!op.body?.trim())fail('BODY','创建必须提供正文，不自动编造专业原则或业务知识');
      }else{
        if(!id||op.parentId||op.slug)fail('OBJECT_ID','更新或删除只接受查询返回的 id');
        await this.w.paths.knowledge(this.w.entry.path,id+'/__check__');
        if(op.kind==='agent')get(id+'/agent.json');else if(op.kind==='module')get(id+'/module.json');
        else {const segment=op.kind==='skill'?'/skills/':'/workflows/';const cut=id.lastIndexOf(segment);if(cut<0||id.slice(cut+segment.length).includes('/'))fail('OBJECT_ID','方法 ID 无效');owner=id.slice(0,cut)}
      }
      if(op.kind==='agent'&&!id.startsWith('.cbim/team/'))fail('OBJECT_ID','Agent ID 越界');
      if(op.kind==='module'&&!id.startsWith('.cbim/workspace/'))fail('OBJECT_ID','Module ID 越界');
      const method=op.kind==='skill'||op.kind==='workflow';
      let inventory:any,items:any[],key='';
      if(method){
        key=op.kind==='skill'?'skills':'workflows';definitionPath=owner+(op.kind==='workflow'?'/module.json':map.has(owner+'/agent.json')?'/agent.json':'/skills.json');
        inventory=map.has(definitionPath)?get(definitionPath):{skills:[]};items=inventory[key];if(!Array.isArray(items!))fail('INVENTORY','归属清单格式错误');
        const ref=pp.relative(owner,id)+(op.kind==='skill'?'/SKILL.md':'/workflow.md');
        const position=items!.findIndex((i:any)=>i.reference===ref);
        if(op.action!=='create'&&position<0)fail('OBJECT_NOT_FOUND','方法未登记在所属对象');
        if(op.action==='create')items!.push({name:('name' in data&&data.name)||op.slug,...(op.kind==='skill'?{purpose:('purpose' in data&&data.purpose)||''}:{}),reference:ref});
        else if(op.action==='update')items![position]={...items![position],...data};
        else items!.splice(position,1);
        set(definitionPath,inventory);
        if(op.action!=='delete'&&op.body!==undefined)map.set(owner+'/'+ref,op.body);
      }else if(op.action!=='delete'){
        definitionPath=id+(op.kind==='agent'?'/agent.json':'/module.json');
        const initial=op.kind==='agent'?{name:op.slug,summary:'',authors:[],capabilities:[],limitations:[],connectors:[],work_principles:'principles.md',skills:[]}:{id,name:op.slug,summary:'',authors:[],sources:[],connectors:[],overview:'module.md',children:[],workflows:[]};
        const definition=op.action==='create'?initial:get(definitionPath);set(definitionPath,{...definition,...data});
        if(op.body!==undefined){const ref=op.kind==='agent'?definition.work_principles:definition.overview;const target=pp.normalize(pp.join(id,ref));if(!target.startsWith(id+'/'))fail('REFERENCE','对象正文引用越出自身目录');map.set(target,op.body)}
        if(op.action==='create'&&op.kind==='module'&&owner!=='.cbim/workspace'){const p=owner+'/module.json',d=get(p);d.children.push(id);set(p,d)}
      }
      if(op.action==='delete'){
        deletedRoots.push(id);
        const owned=[...map.keys()].filter(p=>p.startsWith(id+'/'));
        if(!owned.length)fail('OBJECT_NOT_FOUND','对象不存在');
        const dependents=owned.filter(p=>(p.endsWith('/module.json')||p.endsWith('/agent.json'))&&pp.dirname(p)!==id||p.includes('/skills/')&&p.endsWith('/SKILL.md')||p.includes('/workflows/')&&p.endsWith('/workflow.md'));
        if(!method&&dependents.length&&!op.cascade)fail('HAS_CHILDREN','对象仍包含子模块或方法；需显式 cascade 才能删除');
        // Non-knowledge resources must not be silently orphaned or deleted by a text transaction.
        await this.w.objects.assertKnowledgeOnly(id,s.files);
        for(const p of owned)map.delete(p);
        if(op.kind==='module'){const p=pp.dirname(id)+'/module.json';if(map.has(p)){const d=get(p);d.children=d.children.filter((c:string)=>c!==id);set(p,d)}}
      }
      objects.push(id);
      resolvedOperations.push({kind:op.kind,action:op.action,id,...(op.cascade!==undefined?{cascade:op.cascade}:{})});
    }
    const changes=[...new Set([...s.files.map(f=>f.path),...map.keys()])].filter(p=>!INDEXES.includes(p)&&s.files.find(f=>f.path===p)?.text!==map.get(p)).map(p=>({path:p,text:map.get(p)??null}));
    const request:ChangeRequest={workspaceId:s.workspaceId,instanceId:s.instanceId,revision,requestId:randomUUID(),changes};
    const preview=await this.w.preview(request);const planId=request.requestId;
    const plan={version:2 as const,request,operations:resolvedOperations,deletedRoots};
    await this.w.objects.savePlan(planId,{...plan,planHash:knowledgePlanHash(plan)});
    return {...preview,planId,objects,notice:'仅预览。调用 cbim_object_commit(planId) 才提交；校验失败不能提交。空目录可能保留，不删除业务源码或资源。'};
  }
  /** 读取计划并核验指纹、实例和版本；写授权由核心知识服务调用边界检查。 */
  async commit(planId:string):Promise<ObjectCommit>{
    if(!/^[0-9a-f-]{36}$/.test(planId))fail('PLAN','无效预览标识');
    const plan=await this.w.objects.readPlan(planId);
    if(plan.request.requestId!==planId)fail('PLAN','预览数据不一致');
    const result=await this.w.commitPlanned({kind:'object_plan',planId});
    // Prune only empty object directories; never recursively delete resources.

    const cleanupWarnings:string[]=[];
    for(const id of plan.deletedRoots||[])if(plan.request.changes.some((c:any)=>c.path.startsWith(id+'/')&&c.text===null)&&id.split('/').length>2)try{await this.w.objects.pruneEmpty(id)}catch(e:any){cleanupWarnings.push(`${id}: ${e.message}`)}
    return {...result,cleanupWarnings};
  }
}
