/**
 * 作用定位：向 CBIM 内部大脑提供知识查询、对象事务和内置 Skill 工具。
 * 设计原因：先声明实际能力再消费运行授权；领域执行一次，业务输出按唯一 JSON 快照校验，不因返回异常重放事务。提交输入与原事务观察共用解析定义，保持实际参数顺序和旧 strip 行为。
 */
import {z} from 'zod';
import {ToolRegistry,type ToolDefinition} from '../../core/tools/registry';
import type {KnowledgeWorkspace} from '../../core/knowledge/ports';
import {fail} from '../../core/foundation/errors';
import {Builtins,builtinSkills} from '../../core/knowledge/builtins';
import {KnowledgeQueries} from '../../core/knowledge/knowledge-queries';
import {ObjectCrud,objectOperation} from '../../core/knowledge/object-crud';
import type {ToolEffect} from '../../core/tools/types';
import {knowledgeToolContract} from './knowledge-contracts';
import {context as snapshotContext} from '../../core/knowledge/snapshot';
import {defaultExecutorId,defaultExecutorDefinition,defaultExecutorConfiguration} from '../context/default-executor';
import {knowledgeCommitInputSchema,knowledgeObjectCommitInputSchema} from '../../core/knowledge/knowledge-write-input';
const identity={workspaceId:z.string(),instanceId:z.string()};
export class KnowledgeTools {
  private readonly registry=new ToolRegistry<boolean>();
  readonly queries:KnowledgeQueries;
  constructor(readonly workspace:KnowledgeWorkspace){
    const builtins=new Builtins(workspace.rules.designRoot);
    const queries=this.queries=new KnowledgeQueries(workspace);
    const objects=new ObjectCrud(workspace);
    const register=(name:string,config:{description?:string;inputSchema:z.ZodRawShape;effects?:readonly ToolEffect[]},execute:ToolDefinition<boolean>['execute'])=>{this.registry.register({name,version:1,effects:['read'],...config,...knowledgeToolContract(name),execute})};
    const wrap=(fn:(args:any,write:boolean)=>Promise<unknown>|unknown)=>async(args:any,write:boolean)=>{
      return await fn(args,write);
    };
    register('cbim_workspace_identity',{description:'核验工程与运行实例。不能启动工作区。',inputSchema:{}},async(_args,write)=>({workspaceId:workspace.entry.id,root:workspace.entry.path,instanceId:workspace.instanceId,state:workspace.state,writeEnabled:write}));
    register('cbim_knowledge_tool_catalog',{description:'按需列出本知识服务实际注册的工具摘要。family为knowledge，不含原生、派发或外部插件；定义不代表本次调用已获授权。',inputSchema:identity},()=>this.registry.catalog());
    register('cbim_knowledge_tool_describe',{description:'按工具名称读取本知识注册表的完整输入/输出Schema、版本、副作用和取消/恢复说明；只描述实际条目，不执行工具或授予权限。',inputSchema:{...identity,name:z.string().min(1).max(128)}},args=>this.registry.describe(args.name));
    register('cbim_knowledge_snapshot',{description:'读取正式知识、版本、模块树与校验结果；不包含本地记忆。',inputSchema:identity},wrap(()=>workspace.snapshot()));
    register('cbim_knowledge_search',{inputSchema:{...identity,query:z.string().max(200)}},wrap(async args=>{const snapshot=await workspace.read();return {...snapshot,files:snapshot.files.filter(f=>f.path.includes(args.query)||f.text.toLowerCase().includes(args.query.toLowerCase()))}}));
    register('cbim_builtin_catalog',{description:'列出 CBIM 内置知识治理 Skill、通用规范与 Schema，返回可读取 ID、内容版本和来源；只读。',inputSchema:identity},wrap(()=>builtins.catalog()));
    register('cbim_builtin_read',{description:'按 cbim_builtin_catalog 或 references 返回的 ID 获取内置正文、版本及已解析引用。不是本地文件读取接口；资料只读。',inputSchema:{...identity,id:z.string().max(100),expectedVersion:z.string().optional()}},wrap(args=>builtins.read(args.id,args.expectedVersion)));
    for(const skill of builtinSkills){const name='cbim_skill_'+skill.id.replaceAll('-','_');register(name,{description:`读取内置「${skill.title}」流程：${skill.description}。返回正文、版本及引用，由调用方执行；调用本工具不会启动业务或修改文件。`,inputSchema:identity},wrap(()=>builtins.read(skill.id)))}
    register('cbim_module_registry',{description:'按关键词查询当前模块注册表，返回 Module ID、摘要与根节点；不改写磁盘。',inputSchema:{...identity,query:z.string().max(200).optional()}},wrap(args=>queries.modules(args.query)));
    register('cbim_module_get',{description:'按注册表 ID 返回 Module 定义、知识正文及本模块 Workflow 列表和正文；不继承父模块流程。',inputSchema:{...identity,id:z.string()}},wrap(args=>queries.module(args.id)));
    register('cbim_agent_registry',{description:'查询团队分组与 Agent 注册表；builtinAgents 包含只读内置默认执行角色 cbim:executor，无合适自定义执行角色时可派发给它。主 Agent 仅调度。',inputSchema:{...identity,query:z.string().max(200).optional()}},wrap(async args=>{const result=await queries.agents(args.query),query=String(args.query??'').toLowerCase();return {...result,builtinAgents:!query||`${defaultExecutorId} ${defaultExecutorDefinition.name} ${defaultExecutorDefinition.summary}`.toLowerCase().includes(query)?[{...defaultExecutorDefinition}]:[]}}));
    register('cbim_people_list',{description:'查询真人花名册与团队归属，用于人员责任与候选 Agent 定位，不授予维护权限。',inputSchema:{...identity,query:z.string().max(200).optional()}},wrap(args=>queries.people(args.query)));
    register('cbim_agent_get',{description:'按 Agent ID 返回定义、原则和有效 Skill；cbim:executor 返回应用内置默认执行角色与 Team 根继承 Skill，不创建 .cbim 文件。其他角色继承冲突显式返回。',inputSchema:{...identity,id:z.string()}},wrap(async args=>{
      if(args.id!==defaultExecutorId)return queries.agent(args.id);
      const snapshot=await workspace.snapshot(),agent=defaultExecutorConfiguration(snapshot);
      return {...snapshotContext(snapshot),id:defaultExecutorId,source:'builtin',definition:{...defaultExecutorDefinition},principles:{available:true,text:agent.principles},skillChain:[agent.teamId],skillConflicts:[],skillSelectionValid:true,skills:agent.effectiveSkills.map(skill=>({id:skill.skillId,owner:skill.ownerId,inherited:true,content:{available:true,text:skill.content}}))};
    }));
    register('cbim_knowledge_refresh',{effects:['knowledge-write'],description:'重新校验当前知识并刷新派生注册表；所有知识修改必须通过 CBIM 知识服务。需取得本次运行的知识写入授权，全部结构校验通过才事务更新派生注册表，不修改用户正文。错误返回问题清单，改完再调用。',inputSchema:identity},wrap(()=>queries.refresh()));
    register('cbim_object_preview',{effects:['preview'],description:'预览 Agent/Module/Skill/Workflow 的创建、更新或删除。创建传 parentId、slug、data、body；更新传 id 与需修改字段；删除传 id，包含子对象时需 cascade。服务规划路径、清单和父子引用，不写正式知识。返回 planId、变更及校验。',inputSchema:{...identity,revision:z.string(),operations:z.array(objectOperation).min(1).max(100)}},wrap(args=>objects.preview(args.revision,args.operations)));
    register('cbim_object_commit',{effects:['knowledge-write'],description:'提交 cbim_object_preview 返回的 planId。须取得本次运行的知识写入授权；核对原版本，事务写入知识及索引，同一计划幂等。',inputSchema:knowledgeObjectCommitInputSchema.shape},wrap((args,write)=>{if(!write)fail('FORBIDDEN','当前调用未获得知识写入权限');return objects.commit(args.planId)}));
    const changeSchema=knowledgeCommitInputSchema.shape;
    register('cbim_knowledge_preview',{effects:['preview'],description:'校验修改并预览影响，不写入。',inputSchema:changeSchema},wrap(args=>workspace.preview(args)));
    register('cbim_knowledge_commit',{effects:['knowledge-write'],description:'取得本次运行的知识写入授权后提交文件事务，核对读取版本与幂等请求标识。',inputSchema:changeSchema},wrap((args,write)=>{if(!write)fail('FORBIDDEN','当前调用未获得知识写入权限');return workspace.commit(args)}));
    register('cbim_knowledge_move_preview',{effects:['preview'],inputSchema:{...identity,from:z.string(),to:z.string().nullable()}},wrap(async args=>workspace.preview(await workspace.planMove(await workspace.read(),args.from,args.to))));
    register('cbim_rules_validate',{effects:['maintenance'],description:'启动本工作区知识规则检查，返回维护任务 ID。它不是对话任务或团队派发任务。',inputSchema:identity},wrap(()=>workspace.startTask('validate')));
    register('cbim_task_status',{description:'查询本工作区知识检查/索引维护任务，taskId 使用维护接口返回的 ID；不用于主对话、执行计划或成员派发任务。找不到返回 not_found。',inputSchema:{...identity,taskId:z.string()}},wrap(args=>workspace.tasks.get(args.taskId)||{state:'not_found'}));
    register('cbim_task_cancel',{effects:['maintenance'],description:'请求取消本工作区知识检查/索引维护任务；只接受维护接口返回的 taskId，不接受主对话、执行计划或成员派发任务 ID。不存在报 TASK_NOT_FOUND；已结束返回原状态，取消请求不代表事务已经回滚。',inputSchema:{...identity,taskId:z.string()}},wrap(args=>workspace.cancelTask(args.taskId)));
  }
  /** 返回实际工具 Schema，供内部引擎注册可调用能力。 */
  list(){return this.registry.list()}
  /** 授权前解析参数和实例身份；只检查，不执行或创建预览。 */
  describe(name:string,input:unknown){
    const {tool,args}=this.registry.resolve(name,input);
    this.workspace.assert(name==='cbim_workspace_identity'?undefined:args as {workspaceId:string;instanceId:string});
    return {effects:tool.effects,native:false};
  }
  /** 由执行桥在一次性 gate 授权后调用；write 来自运行策略，不能由模型输入自行授予。 */
  async callFromRun(name:string,input:unknown,write:boolean,signal?:AbortSignal){
    if(!write&&this.describe(name,input).effects.includes('knowledge-write'))fail('FORBIDDEN','本轮未获得知识写入权限');
    return this.invoke(name,input,write,signal);
  }
  private async invoke(name:string,input:unknown,write:boolean,signal?:AbortSignal){
    signal?.throwIfAborted();
    const {tool,args}=this.registry.resolve(name,input);
    if(name==='cbim_workspace_identity')this.workspace.assert();
    else this.workspace.assert(args as {workspaceId:string;instanceId:string});
    return this.registry.invokeResolved(tool,args,write);
  }
}
const services=new WeakMap<KnowledgeWorkspace,KnowledgeTools>();
/** 同一工作区实例共享预览计划；重启实例后不继承旧计划。 */
export function knowledgeTools(workspace:KnowledgeWorkspace){let service=services.get(workspace);if(!service){service=new KnowledgeTools(workspace);services.set(workspace,service)}return service}
