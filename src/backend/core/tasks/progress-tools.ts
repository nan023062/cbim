/**
 * 作用定位：内部 Loop 的任务计划、步骤证据和交付工具，状态通过注入的持久化回调保存。
 * 设计原因：普通问答不创建计划；真实运行身份和代次限定证据。保存前冻结请求和前态，保存后只核一次原 wire，失败不回滚已保存版本；Workflow 仍在真实交付时复核在途副作用。
 */
import {zodToJsonSchema} from 'zod-to-json-schema';
import type {TaskProgress} from './progress';
import type {ToolReceipt} from '../tools/types';
import type {ArtifactBaselineRef} from './artifact-baseline';
import {checkedJsonToolResult} from '../tools/results';
import {fail} from '../foundation/errors';
import {assertWorkflowPlan,evaluateWorkflowDelivery,type WorkflowProgressContext} from './workflow-evidence';
import {progressToolInputSchemas,type ProgressPlanInput,type ProgressStepInput,type ProgressDeliveryInput} from './progress-schema';
import {isProgressEvidence,memberToolContract,memberToolOutputSchema,progressToolIdentitySchema,type MemberToolName,type ProgressToolIdentity,type ProgressOutputBasis} from './member-tool-output';

const definitions={
  cbim_task_inspect:{description:'读取本会话执行计划和本轮可引用的成功工具回执。普通问答无需创建计划。',schema:progressToolInputSchemas.cbim_task_inspect},
  cbim_task_plan:{description:'创建或修订执行计划。expectedVersion 初次为 0；修订清除旧证据并保留历史。责任是描述，不会派发其他 Agent。',schema:progressToolInputSchemas.cbim_task_plan},
  cbim_task_step:{description:'更新步骤；reported_done 必须引用 cbim_task_inspect 返回的本轮有效 evidenceIds。完成声明仍需人工判断。',schema:progressToolInputSchemas.cbim_task_step},
  cbim_delivery_prepare:{description:'准备交付候选。全部步骤须有有效回执证据；只标记待审阅，不能表示业务验收通过。',schema:progressToolInputSchemas.cbim_delivery_prepare},
};
/** 工具只维护执行记录，不修改项目或知识；参数校验可在授权前独立调用。 */
export function progressTool(name:string,input:unknown){
  if(!Object.hasOwn(definitions,name))return undefined;
  const definition=definitions[name as keyof typeof definitions];
  if(!definition)return undefined;
  return {args:definition.schema.parse(input),effects:['maintenance'] as const,native:false};
}
/** 仅暴露本实现的参数协议；名称、输入 Schema 和描述不构成工具执行授权。 */
export const progressToolSchemas=Object.entries(definitions).map(([name,d])=>({name,description:d.description,inputSchema:zodToJsonSchema(d.schema) as Record<string,unknown>,...memberToolContract(name as MemberToolName)}));

/** 每个运行独立持有计划与证据代次；变更串行落盘，正式派发图的状态由外层调度结算。 */
export class TaskProgressTools {
  /** 只注册当前运行实际实现的任务工具；结果绑定所属日志和任务身份。 */
  async list(){return progressToolSchemas}
  private state?:TaskProgress;
  private evidence=new Map<string,ToolReceipt>();
  /** 副作用放行代次；先前并发读操作迟到的结果不能为新产物作证。 */
  generation=0;
  private tail:Promise<unknown>=Promise.resolve();
  /** 有约定的续执行也须保存本轮计划，避免把旧轮次计划或证据假装成本轮已核实。 */
  private planEstablished=false;
  private readonly workflow?:WorkflowProgressContext;
  private readonly identity:ProgressToolIdentity;
  /** save 成功才替换内存状态；恢复保留计划，但不沿用上轮尚未重新核实的证据。 */
  constructor(previous:TaskProgress|undefined,private save:(state:TaskProgress)=>Promise<void>,private readonly ports:{identity:ProgressToolIdentity;artifacts?():ArtifactBaselineRef[];workflow?:WorkflowProgressContext;
    /** 真正执行交付时再同步核在途副作用，防止已获 gate 后才出现写入；不请求权限或执行 I/O。 */
    assertDeliveryReady?():void;
  }){this.state=previous?structuredClone(previous):undefined;this.workflow=ports.workflow?structuredClone(ports.workflow):undefined;this.identity=structuredClone(ports.identity);if(!progressToolIdentitySchema.safeParse(this.identity).success)fail('TASK_PROGRESS_IDENTITY','执行进度必须绑定真实工作区、任务与运行')}
  /** 只返回当前计划副本；可信采集端口用它核实版本，不允许工具或调用方直接修改计划。 */
  current():TaskProgress|undefined{return this.state?structuredClone(this.state):undefined}
  /** 审批前同步检查；返回的版本必须在审批后由 invalidate 同队列重新比较。 */
  beforeEffects():number|undefined{
    if(!this.workflow?.bindings.length)return;
    const version=assertWorkflowPlan(this.workflow.bindings,this.planEstablished?this.state:undefined,this.workflow.task);return version;
  }
  private serial<T>(work:()=>Promise<T>):Promise<T>{const next=this.tail.then(work);this.tail=next.catch(()=>{});return next}
  /** 保存前隔离内存状态；返回原值交唯一 wire 校验，save 的坏回包不能冒充回滚或污染已知计划。 */
  private async persist(next:TaskProgress){const committed=structuredClone(next);await this.save(next);this.state=committed;return next}
  /** 新轮次或任何写入/命令放行前使证据失效；失败/取消也不能假设产物未改变。 */
  invalidate(reason:string,expectedPlanVersion?:number){return this.serial(async()=>{
    if(expectedPlanVersion!==undefined&&this.state?.version!==expectedPlanVersion)fail('WORKFLOW_PLAN_STALE','审批期间执行计划已变化，请基于当前计划重新发起此操作');
    this.generation++;this.evidence.clear();if(!this.state)return;
    await this.persist({...this.state,version:this.state.version+1,state:'executing',reason,delivery:undefined,steps:this.state.steps.map(s=>({...s,state:s.state==='reported_done'?'pending':s.state,evidence:[]}))});
  })}
  /** 只接收运行时生成的业务回执；外部仓库资料、任务记录、派发、目标审阅与候选工具不能替代实际业务交付证据。 */
  /** 历史报告可读取缺哈希的旧回执；当前证据必须有明确成功结果和真实三身份。忽略不可引用项，不删除原日志。 */
  record(receipt:ToolReceipt,generation:number){if(generation===this.generation&&isProgressEvidence(receipt,this.identity))this.evidence.set(receipt.toolCallId,structuredClone(receipt))}
  /** 桥的一次性 gate 之后调用；状态版本和证据再次核验，返回可序列化工具结果。 */
  call(name:string,input:unknown){return this.serial(async()=>{
    const parsed=progressTool(name,input);if(!parsed)throw Error('未知任务工具');
    const args=structuredClone(parsed.args) as ProgressPlanInput|ProgressStepInput|ProgressDeliveryInput;
    const basis:ProgressOutputBasis={previous:this.current(),expected:undefined,evidence:structuredClone([...this.evidence.values()]),...(this.workflow?{workflow:structuredClone(this.workflow)}:{})};
    const expectedInput=structuredClone(args);
    let result:unknown;
    if(name==='cbim_task_inspect'){
      basis.expected={plan:this.current()??null,evidence:structuredClone([...this.evidence.values()]),...(this.workflow?.bindings.length?{workflowContracts:structuredClone(this.workflow.bindings)}:{})};
      basis.artifactsAvailable=!!this.ports.artifacts;
      // 外部端口值不先 clone/parse；它必须以原 JSON wire 通过严格 Schema，不把 toJSON 或缺字段隐藏在预处理里。
      result={...basis.expected as object,...(this.ports.artifacts?{artifacts:this.ports.artifacts()}: {})};
    }
    else{
      if(args.expectedVersion!==(this.state?.version??0))throw Error('任务计划版本已变化，请重新读取');
      if(name==='cbim_task_plan'){
        const draft=args as ProgressPlanInput;
        if(new Set(draft.steps.map(s=>s.id)).size!==draft.steps.length)throw Error('步骤 ID 不能重复');
        const next:TaskProgress={version:draft.expectedVersion+1,goal:draft.goal,reason:draft.reason,acceptance:draft.acceptance,state:'executing',steps:draft.steps.map(s=>({...s,state:'pending',evidence:[]}))};
        basis.expected=structuredClone(next);result=await this.persist(next);
        this.planEstablished=true;
        this.generation++;this.evidence.clear();
      }else{
        if(!this.state)throw Error('请先创建任务计划');
        const next=structuredClone(this.state);next.version++;
        if(name==='cbim_task_step'){
          const draft=args as ProgressStepInput,step=next.steps.find(s=>s.id===draft.id);if(!step)throw Error('步骤不存在');
          if(draft.state==='reported_done'&&!draft.evidenceIds.length)throw Error('缺少执行证据，不能报告完成');
          if(draft.evidenceIds.some(id=>!this.evidence.has(id)))throw Error('证据不存在、已过期或不属于本轮');
          Object.assign(step,{state:draft.state,evidence:draft.evidenceIds});next.state='executing';delete next.delivery;
        }else{
          this.ports?.assertDeliveryReady?.();
          if(next.steps.some(s=>s.state!=='reported_done'||!s.evidence.length||s.evidence.some(id=>!this.evidence.has(id))))throw Error('仍有未完成步骤或缺失有效证据');
          const draft=args as ProgressDeliveryInput;next.state='awaiting_review';next.delivery={summary:draft.summary,limitations:draft.limitations};
          if(this.workflow?.bindings.length){
            if(!this.planEstablished||next.goal!==this.workflow.task.goal||JSON.stringify(next.acceptance)!==JSON.stringify(this.workflow.task.acceptance))fail('WORKFLOW_PLAN_REQUIRED','Workflow 交付要求本轮保存与原任务一致的计划');
            const selected=[...new Set(next.steps.flatMap(step=>step.evidence))].map(id=>this.evidence.get(id)!);
            next.delivery.workflow=evaluateWorkflowDelivery(this.workflow.bindings,selected,this.workflow.identity);
          }
        }
        basis.expected=structuredClone(next);result=await this.persist(next);
      }
    }
    return checkedJsonToolResult(name,result,memberToolOutputSchema(name as MemberToolName,{binding:this.identity,input:expectedInput,progress:basis}));
  })}
}
