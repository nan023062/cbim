/**
 * 知识身份允许缺省：先核实绑定实例并读取当前身份；显式身份不覆盖，业务版本/命令与写权限不自动补齐。
 * 对象维护优先 object_preview/commit；底层 knowledge 文件事务标为兼容，保留无法由对象操作表达的维护场景。
 * 作用定位：向 CBIM 内部大脑提供知识查询、对象事务和内置 Skill 工具。
 * 设计原因：查询只注入快照读取，刷新单独装配事务端口；先声明实际能力和契约版本再消费运行授权。领域执行一次，业务输出按唯一 JSON 快照校验，不因返回异常重放事务。
 */
import {z} from 'zod';
import {ToolRegistry,type ToolDefinition} from '../../core/tools/registry';
import type {KnowledgeWorkspace} from '../../core/knowledge/ports';
import {fail} from '../../core/foundation/errors';
import {Builtins,builtinSkills} from '../../core/knowledge/builtins';
import {KnowledgeQueries} from '../../core/knowledge/knowledge-queries';
import {KnowledgeRefresh} from '../../core/knowledge/knowledge-refresh';
import {ObjectCrud,objectOperation} from '../../core/knowledge/object-crud';
import type {ToolEffect} from '../../core/tools/types';
import {knowledgeToolContract} from './knowledge-contracts';
import {knowledgeCommitInputSchema,knowledgeObjectCommitInputSchema,knowledgeRefreshInputSchema} from '../../core/knowledge/knowledge-write-input';
export class KnowledgeTools {
  private readonly registry=new ToolRegistry<boolean>();
  readonly queries:KnowledgeQueries;
  constructor(readonly workspace:KnowledgeWorkspace){
    // 与 identity 查询共用当前已绑定实例；仅 undefined 使用默认值，显式旧值仍由 assert 拒绝。
    const currentIdentity=()=>{workspace.assert();return {workspaceId:workspace.entry.id,instanceId:workspace.instanceId}};
    const identity={workspaceId:z.string().default(()=>currentIdentity().workspaceId),instanceId:z.string().default(()=>currentIdentity().instanceId)};
    const builtins=new Builtins(workspace.rules.designRoot);
    const queries=this.queries=new KnowledgeQueries({snapshot:()=>workspace.snapshot()});
    const refresh=new KnowledgeRefresh({snapshot:()=>workspace.snapshot(),assert:identity=>workspace.assert(identity),committedReceipt:request=>workspace.committedReceipt(request),commit:request=>workspace.commit(request)});
    const objects=new ObjectCrud(workspace);
    const register=(name:string,config:{version?:number;description?:string;inputSchema:z.ZodRawShape;effects?:readonly ToolEffect[]},execute:ToolDefinition<boolean>['execute'])=>{
      const inputSchema={...config.inputSchema};
      for(const key of ['workspaceId','instanceId'] as const)if(Object.hasOwn(inputSchema,key))inputSchema[key]=identity[key];
      this.registry.register({name,version:1,effects:['read'],...config,inputSchema,...knowledgeToolContract(name),execute});
    };
    const wrap=(fn:(args:any,write:boolean)=>Promise<unknown>|unknown)=>async(args:any,write:boolean)=>{
      return await fn(args,write);
    };
    register('cbim_workspace_identity',{description:'核验工程与运行实例。不能启动工作区；知识工具省略身份时自动读取此当前实例身份，显式传入的身份仍须匹配。',inputSchema:{}},async(_args,write)=>({...currentIdentity(),root:workspace.entry.path,state:workspace.state,writeEnabled:write}));
    register('cbim_knowledge_tool_catalog',{description:'按需列出本知识服务实际注册的工具摘要。family为knowledge，不含原生、派发或外部插件；定义不代表本次调用已获授权。',inputSchema:identity},()=>this.registry.catalog());
    register('cbim_knowledge_tool_describe',{description:'按工具名称读取本知识注册表的完整输入/输出Schema、版本、副作用和取消/恢复说明；只描述实际条目，不执行工具或授予权限。',inputSchema:{...identity,name:z.string().min(1).max(128)}},args=>this.registry.describe(args.name));
    register('cbim_knowledge_snapshot',{description:'读取正式知识、版本、模块树与校验结果；不包含本地记忆。',inputSchema:identity},wrap(()=>workspace.snapshot()));
    register('cbim_knowledge_search',{inputSchema:{...identity,query:z.string().max(200)}},wrap(async args=>{const snapshot=await workspace.read();return {...snapshot,files:snapshot.files.filter(f=>f.path.includes(args.query)||f.text.toLowerCase().includes(args.query.toLowerCase()))}}));
    register('cbim_builtin_catalog',{description:'列出 CBIM 内置知识治理 Skill、通用规范与 Schema，返回可读取 ID、内容版本和来源；只读。',inputSchema:identity},wrap(()=>builtins.catalog()));
    register('cbim_builtin_read',{description:'按 cbim_builtin_catalog 或 references 返回的 ID 获取内置正文、版本及已解析引用。不是本地文件读取接口；资料只读。',inputSchema:{...identity,id:z.string().max(100),expectedVersion:z.string().optional()}},wrap(args=>builtins.read(args.id,args.expectedVersion)));
    for(const skill of builtinSkills){const name='cbim_skill_'+skill.id.replaceAll('-','_');register(name,{description:`读取内置「${skill.title}」流程：${skill.description}。返回正文、版本及引用，由调用方执行；调用本工具不会启动业务或修改文件。`,inputSchema:identity},wrap(()=>builtins.read(skill.id)))}
    register('cbim_module_registry',{version:2,description:'查询当前模块注册表与始终可用的 projectRoot（cbim:project）；关键词仅筛选已定义模块，不改写磁盘。',inputSchema:{...identity,query:z.string().max(200).optional()}},wrap(args=>queries.modules(args.query)));
    register('cbim_module_get',{version:2,description:'按 ID 返回 Module 定义、正文及本模块 Workflow；cbim:project 返回内置项目根范围，不伪造文件或继承流程。',inputSchema:{...identity,id:z.string()}},wrap(args=>queries.module(args.id)));
    register('cbim_agent_registry',{description:'查询团队分组与自定义 Agent 注册表。未配置自定义负责 Agent 的模块由主 Agent 在当前会话直接执行；builtinAgents 保留空数组，不再提供默认执行员。',inputSchema:{...identity,query:z.string().max(200).optional()}},wrap(async args=>({...await queries.agents(args.query),builtinAgents:[]})));
    register('cbim_agent_get',{description:'按自定义 Agent ID 返回定义、原则和有效 Skill；继承冲突显式返回。主 Agent 是隐式默认执行者，无需登记；旧 cbim:executor 已退役。',inputSchema:{...identity,id:z.string()}},wrap(args=>{
      if(args.id==='cbim:executor')fail('AGENT_RETIRED','内置默认执行 Agent 已退役；未配置自定义 Agent 的模块由主 Agent 直接执行');
      return queries.agent(args.id);
    }));
    register('cbim_knowledge_refresh',{version:2,effects:['knowledge-write'],description:'按已读取的 revision 和明确 requestId 校验知识并刷新派生索引，不修改正文。需本轮知识写入授权；同ID只查询/复用完全相同原请求，结果未知不得换ID重试。结构无效返回问题清单，修正后重新读取。',inputSchema:knowledgeRefreshInputSchema.shape},wrap(args=>refresh.refresh(args)));
    register('cbim_object_preview',{version:2,effects:['preview'],description:'预览 Agent/Module/Skill/Workflow 的创建、更新或删除。data 严格按 kind 区分：agent 不支持 purpose，module 不支持 name（name 固定为 slug，中文名写 body 的 H1）。创建传 parentId、slug、data、body；更新传 id 与需修改字段；删除传 id，包含子对象时需 cascade。服务规划路径、清单和父子引用，不写正式知识。返回 planId、变更及完整 validation.issues；structural:false 是校验未通过，不是执行异常，修正全部问题后重新预览。Module 根 parentId 为 .cbim/workspace（不是物理目录或 cbim:project）；同一 operations 可先建父再建子。summary 为 100–250 非空白字符单行，保留 slug、五章正文及直属内容虚拟节点约束见字段 Schema。',inputSchema:{...identity,revision:z.string(),operations:z.array(objectOperation).min(1).max(100)}},wrap(args=>objects.preview(args.revision,args.operations)));
    register('cbim_object_commit',{effects:['knowledge-write'],description:'提交 cbim_object_preview 返回的 planId。须取得本次运行的知识写入授权；核对原版本，事务写入知识及索引，同一计划幂等。',inputSchema:knowledgeObjectCommitInputSchema.shape},wrap((args,write)=>{if(!write)fail('FORBIDDEN','当前调用未获得知识写入权限');return objects.commit(args.planId)}));
    const changeSchema=knowledgeCommitInputSchema.shape;
    register('cbim_knowledge_preview',{effects:['preview'],description:'底层文件事务兼容入口；普通对象创建/更新/删除优先 cbim_object_preview/commit。仅在对象操作不能表达时使用。校验修改并预览影响，不写入。',inputSchema:changeSchema},wrap(args=>workspace.preview(args)));
    register('cbim_knowledge_commit',{effects:['knowledge-write'],description:'底层文件事务兼容入口；普通对象维护优先 cbim_object_preview/commit。取得本次运行的知识写入授权后提交文件事务，核对读取版本与幂等请求标识。',inputSchema:changeSchema},wrap((args,write)=>{if(!write)fail('FORBIDDEN','当前调用未获得知识写入权限');return workspace.commit(args)}));
    register('cbim_knowledge_move_preview',{effects:['preview'],inputSchema:{...identity,from:z.string(),to:z.string().nullable()}},wrap(async args=>workspace.preview(await workspace.planMove(await workspace.read(),args.from,args.to))));
    register('cbim_rules_validate',{effects:['maintenance'],description:'启动本工作区知识规则检查，返回维护任务 ID。它不是对话任务或团队派发任务。',inputSchema:identity},wrap(()=>workspace.startTask('validate')));
    register('cbim_task_status',{description:'查询本工作区知识检查/索引维护任务，taskId 使用维护接口返回的 ID；不用于主对话、执行计划或成员派发任务。找不到返回 not_found。',inputSchema:{...identity,taskId:z.string()}},wrap(args=>workspace.tasks.get(args.taskId)||{state:'not_found'}));
    register('cbim_task_cancel',{effects:['maintenance'],description:'请求取消本工作区知识检查/索引维护任务；只接受维护接口返回的 taskId，不接受主对话、执行计划或成员派发任务 ID。不存在报 TASK_NOT_FOUND；已结束返回原状态，取消请求不代表事务已经回滚。',inputSchema:{...identity,taskId:z.string()}},wrap(args=>workspace.cancelTask(args.taskId)));
  }
  /** 返回实际工具 Schema，供内部引擎注册可调用能力。 */
  list(){return this.registry.list()}
  /** 只识别当前注册条目，不生成 Schema 或读取默认值。 */
  has(name:string){return this.registry.tools.some(tool=>tool.name===name)}
  /** 可信运行在 proposed 之前冻结实际参数，使审计、授权与知识事务使用相同身份/default。 */
  normalizeInput(name:string,input:unknown){
    const {args}=this.registry.resolve(name,input);
    this.workspace.assert(name==='cbim_workspace_identity'?undefined:args as {workspaceId:string;instanceId:string});
    return args;
  }
  /** 授权前解析参数和实例身份；只检查，不执行或创建预览。 */
  describe(name:string,input:unknown){
    const {tool,args}=this.registry.resolve(name,input);
    this.workspace.assert(name==='cbim_workspace_identity'?undefined:args as {workspaceId:string;instanceId:string});
    return {effects:tool.effects,native:false,contractVersion:tool.version};
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
