/**
 * 作用定位：单轮成员的代码检查门闩，连接冻结命令、权限完成后的真实平台与可信日志。
 * 设计原因：整组检查只占一次命令代次；并发工具、停止、知识漂移或进度变化不能跨过检查窗口。
 * 职责边界：不负责授予 command 权限；当前源码在交付时由同一完整 manifest 再核实。
 */
import {zodToJsonSchema} from 'zod-to-json-schema';
import {fail} from '../../foundation/errors';
import {codeCheckLimits} from '../../workspace/code-check';
import {preparedArtifactScopes} from '../../workspace/artifact-scope';
import {outputManifestHash} from '../../evidence/output-manifest-evidence';
import {codeCheckToolName,codeCheckInputSchema,codeCheckRecordSchema,codeCheckExecutionSchema,codeCheckOutput,codeCheckPassed,codeRequirementsHash,frozenCodeChecks,verifyCodeChecks,type CodeCheckBinding,type CodeCheckIdentity,type CodeCheckPort,type CodeCheckRecord} from '../../evidence/code-check';
import type {StoredEvent} from '../types';

export interface CodeCheckContext {
  currentVersion():number|undefined;generation():number;assertReady(id:string):void;
  assertKnowledge():Promise<void>;save(record:CodeCheckRecord):Promise<void>;
}
/** 未声明时不装配；跨模块总数和冻结范围在模型启动之前拒绝，不留到真正执行时猜测。 */
export function prepareCodeChecks(bindings:readonly CodeCheckBinding[],port?:CodeCheckPort){
  const checks=frozenCodeChecks(bindings);
  if(checks.length){
    if(!port)fail('CODE_CHECK_UNAVAILABLE','冻结的代码检查缺少真实进程执行端口');
    if(checks.length>codeCheckLimits.checks)fail('CODE_CHECK_LIMIT','一轮代码检查最多八项');
    if(bindings.some(binding=>binding.contract.executionScope||!binding.contract.artifactScope||!binding.contract.delivery?.requireCompleteManifest))fail('CODE_CHECK_SCOPE','代码检查要求全部模块使用完整清单，不能混入隔离范围模式');
    preparedArtifactScopes(bindings);
  }
  return checks.length>0;
}
export class RunCodeCheck {
  private readonly controller=new AbortController();
  private events:StoredEvent[]=[];
  private reserved?:{id:string;consumed:boolean};
  private generations=new Map<string,number>();
  constructor(private readonly bindings:readonly CodeCheckBinding[],private readonly identity:CodeCheckIdentity,private readonly knowledgeRevision:string,private readonly port:CodeCheckPort,private readonly context:CodeCheckContext){this.bindings=structuredClone(bindings);this.identity=structuredClone(identity)}
  async list(){return [{name:codeCheckToolName,version:1,effects:['command'] as const,inputSchema:zodToJsonSchema(codeCheckInputSchema),description:'执行本轮 Workflow 冻结的整组代码检查，命令、cwd、超时、源码范围和通过条件不可由工具参数修改。需要命令权限，会使旧步骤证据失效；检查完成后重新 inspect 进度，用本调用回执更新步骤，再采集完整 manifest 并准备交付。rejected 是已执行但未通过，不能交付。测试模式要求实际通过用例数；源码修改后须重跑整组检查。'}]}
  guard(name:string,id:string,input:unknown,active:readonly string[]){
    if(this.reserved)return '代码检查正在执行，请等待结束';
    if(name!==codeCheckToolName)return;
    if(this.controller.signal.aborted||active.length||!this.context.currentVersion())return '代码检查要求本轮计划、未停止且没有在途工具';
    if(!codeCheckInputSchema.safeParse(input).success)return '代码检查不接受模型提供的命令或结果';
    this.reserved={id,consumed:false};
  }
  observed(event:StoredEvent){
    this.events.push(event);
    if(event.type==='code.validation_checked')this.generations.set(String((event.data.codeCheck as CodeCheckRecord).toolCallId),this.context.generation());
    if(['tool.finished','tool.denied'].includes(event.type)&&event.data.id===this.reserved?.id)this.reserved=undefined;
  }
  stop(){this.controller.abort(Error('运行停止，代码检查取消'))}
  records(){return verifyCodeChecks(this.events,this.bindings,this.identity).filter(record=>record.knowledgeRevision===this.knowledgeRevision&&this.generations.get(record.toolCallId)===this.context.generation())}
  async call(name:string,input:unknown,id:string){
    codeCheckInputSchema.parse(input);
    if(name!==codeCheckToolName||this.reserved?.id!==id||this.reserved.consumed)fail('CODE_CHECK_CALL','代码检查必须来自本轮唯一授权调用');
    this.reserved.consumed=true;
    const generation=this.context.generation(),version=this.context.currentVersion();
    const alive=()=>{this.controller.signal.throwIfAborted();this.context.assertReady(id);if(this.context.generation()!==generation||this.context.currentVersion()!==version)fail('CODE_CHECK_STALE','代码检查期间计划或副作用代次已经变化')};
    alive();await this.context.assertKnowledge();alive();
    const checks=frozenCodeChecks(this.bindings),execution=codeCheckExecutionSchema.parse(await this.port.run(checks,preparedArtifactScopes(this.bindings),this.controller.signal));
    alive();await this.context.assertKnowledge();alive();
    const record=codeCheckRecordSchema.parse({...execution,version:1,identity:this.identity,toolCallId:id,knowledgeRevision:this.knowledgeRevision,requirementsHash:codeRequirementsHash(this.bindings),snapshotHash:outputManifestHash(execution.snapshot),checkedAt:new Date().toISOString(),outcome:codeCheckPassed(checks,execution)?'passed':'rejected'});
    await this.context.save(record);alive();return {content:[{type:'text' as const,text:JSON.stringify(codeCheckOutput(record))}]};
  }
}
