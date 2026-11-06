/**
 * 作用定位：调度层知识工具适配，向内部大脑和可选 MCP 暴露相同工具。
 * 设计原因：领域查询、CRUD 与事务仍由 Core 契约提供；此处只装配参数、身份校验和结果协议，不持有平台实现。
 */
import {z} from 'zod';
import {ToolRegistry,type ToolDefinition} from '../../core/tools/registry';
import type {KnowledgeWorkspace} from '../../core/knowledge/ports';
import {fail} from '../../core/foundation/errors';
import {Builtins,builtinSkills} from '../../core/knowledge/builtins';
import {KnowledgeQueries} from '../../core/knowledge/knowledge-queries';
import {ObjectCrud,objectOperation} from '../../core/knowledge/object-crud';
const identity={workspaceId:z.string(),instanceId:z.string()};
export class KnowledgeTools {
  private readonly registry=new ToolRegistry<boolean>();
  get tools(){return this.registry.tools}
  readonly queries:KnowledgeQueries;
  constructor(readonly workspace:KnowledgeWorkspace){
    const builtins=new Builtins(workspace.rules.designRoot);
    const queries=this.queries=new KnowledgeQueries(workspace);
    const objects=new ObjectCrud(workspace);
    const register=(name:string,config:{description?:string;inputSchema:z.ZodRawShape},execute:ToolDefinition<boolean>['execute'])=>{this.registry.register({name,...config,execute})};
    const wrap=(_name:string,fn:(args:any,write:boolean)=>Promise<unknown>|unknown)=>async(args:any,write:boolean)=>{
      const value=await fn(args,write);return {content:[{type:'text' as const,text:JSON.stringify(value)}]};
    };
    register('cbim_workspace_identity',{description:'核验工程与运行实例。不能启动工作区。',inputSchema:{}},async()=>({content:[{type:'text',text:JSON.stringify({workspaceId:workspace.entry.id,root:workspace.entry.path,instanceId:workspace.instanceId,state:workspace.state,writeEnabled:workspace.writable})}]}));
    register('cbim_knowledge_snapshot',{description:'读取正式知识、版本、模块树与校验结果；不包含本地记忆。',inputSchema:identity},wrap('cbim_knowledge_snapshot',()=>workspace.snapshot()));
    register('cbim_knowledge_search',{inputSchema:{...identity,query:z.string().max(200)}},wrap('cbim_knowledge_search',async args=>{const snapshot=await workspace.read();return {...snapshot,files:snapshot.files.filter(f=>f.path.includes(args.query)||f.text.toLowerCase().includes(args.query.toLowerCase()))}}));
    register('cbim_builtin_catalog',{description:'列出 CBIM 内置知识治理 Skill、通用规范与 Schema，返回可读取 ID、内容版本和来源；只读。',inputSchema:identity},wrap('cbim_builtin_catalog',()=>builtins.catalog()));
    register('cbim_builtin_read',{description:'按 cbim_builtin_catalog 或 references 返回的 ID 获取内置正文、版本及已解析引用。不是本地文件读取接口；资料只读。',inputSchema:{...identity,id:z.string().max(100),expectedVersion:z.string().optional()}},wrap('cbim_builtin_read',args=>builtins.read(args.id,args.expectedVersion)));
    for(const skill of builtinSkills){const name='cbim_skill_'+skill.id.replaceAll('-','_');register(name,{description:`读取内置「${skill.title}」流程：${skill.description}。返回正文、版本及引用，由调用方执行；调用本工具不会启动业务或修改文件。`,inputSchema:identity},wrap(name,()=>builtins.read(skill.id)))}
    register('cbim_module_registry',{description:'按关键词查询当前模块注册表，返回 Module ID、摘要与根节点；不改写磁盘。',inputSchema:{...identity,query:z.string().max(200).optional()}},wrap('cbim_module_registry',args=>queries.modules(args.query)));
    register('cbim_module_get',{description:'按注册表 ID 返回 Module 定义、知识正文及本模块 Workflow 列表和正文；不继承父模块流程。',inputSchema:{...identity,id:z.string()}},wrap('cbim_module_get',args=>queries.module(args.id)));
    register('cbim_agent_registry',{description:'查询当前团队分组与 Agent 注册表，含名称、摘要、作者及真人对应信息。',inputSchema:{...identity,query:z.string().max(200).optional()}},wrap('cbim_agent_registry',args=>queries.agents(args.query)));
    register('cbim_people_list',{description:'查询真人花名册与团队归属，用于人员责任与候选 Agent 定位，不授予维护权限。',inputSchema:{...identity,query:z.string().max(200).optional()}},wrap('cbim_people_list',args=>queries.people(args.query)));
    register('cbim_agent_get',{description:'按 Agent ID 返回定义、原则及自身和所有祖先 Skill 列表/正文/来源。继承冲突显式返回，不自动覆盖。',inputSchema:{...identity,id:z.string()}},wrap('cbim_agent_get',args=>queries.agent(args.id)));
    register('cbim_knowledge_refresh',{description:'重新校验当前知识并刷新派生注册表；所有知识修改必须通过 CBIM 知识服务。检查当前磁盘知识，全部结构校验通过才事务更新派生注册表；不修改用户正文。错误返回问题清单，改完再调用。无需开启 Agent 正文写入开关。',inputSchema:identity},wrap('cbim_knowledge_refresh',()=>queries.refresh()));
    register('cbim_object_preview',{description:'预览 Agent/Module/Skill/Workflow 的创建、更新或删除。创建传 parentId、slug、data、body；更新传 id 与需修改字段；删除传 id，包含子对象时需 cascade。服务规划路径、清单和父子引用，不写正式知识。返回 planId、变更及校验。',inputSchema:{...identity,revision:z.string(),operations:z.array(objectOperation).min(1).max(100)}},wrap('cbim_object_preview',args=>objects.preview(args.revision,args.operations)));
    register('cbim_object_commit',{description:'提交 cbim_object_preview 返回的 planId。必须有写凭据和桌面 Agent 写入授权；核对原版本，事务写入知识及索引，同一计划幂等。',inputSchema:{...identity,planId:z.string()}},wrap('cbim_object_commit',(args,write)=>{if(!write||!workspace.writable)fail('FORBIDDEN','桌面未启用 Agent 写入或凭据没有写权限');return objects.commit(args.planId)}));
    const changeSchema={...identity,revision:z.string(),requestId:z.string(),changes:z.array(z.object({path:z.string(),text:z.string().nullable()})).max(1000)};
    register('cbim_knowledge_preview',{description:'校验修改并预览影响，不写入。',inputSchema:changeSchema},wrap('cbim_knowledge_preview',args=>workspace.preview(args)));
    register('cbim_knowledge_commit',{description:'需桌面开启 Agent 写入、写令牌、读取版本及幂等请求标识。',inputSchema:changeSchema},wrap('cbim_knowledge_commit',(args,write)=>{if(!write||!workspace.writable)fail('FORBIDDEN','桌面未启用 Agent 写入或凭据没有写权限');return workspace.commit(args)}));
    register('cbim_knowledge_move_preview',{inputSchema:{...identity,from:z.string(),to:z.string().nullable()}},wrap('cbim_knowledge_move_preview',async args=>workspace.preview(await workspace.planMove(await workspace.read(),args.from,args.to))));
    register('cbim_rules_validate',{inputSchema:identity},wrap('cbim_rules_validate',()=>workspace.startTask('validate')));
    register('cbim_task_status',{inputSchema:{...identity,taskId:z.string()}},wrap('cbim_task_status',args=>workspace.tasks.get(args.taskId)||{state:'not_found'}));
    register('cbim_task_cancel',{inputSchema:{...identity,taskId:z.string()}},wrap('cbim_task_cancel',args=>workspace.cancelTask(args.taskId)));
  }
  /** 返回实际参数 Schema；内部引擎无需连接 MCP 来发现工具。 */
  list(){return this.registry.list()}
  /** 身份、Schema 与写入开关同样适用于进程内调用；错误保留明确代码。 */
  async call(name:string,input:unknown,write=false,signal?:AbortSignal){
    signal?.throwIfAborted();
    const {tool,args}=this.registry.resolve(name,input);
    if(name==='cbim_workspace_identity')this.workspace.assert();
    else this.workspace.assert(args as {workspaceId:string;instanceId:string});
    return tool.execute(args,write);
  }
}
const services=new WeakMap<KnowledgeWorkspace,KnowledgeTools>();
/** 同一工作区实例共享预览计划；重启实例后不继承旧计划。 */
export function knowledgeTools(workspace:KnowledgeWorkspace){let service=services.get(workspace);if(!service){service=new KnowledgeTools(workspace);services.set(workspace,service)}return service}
