import { CbimRuntime } from '../../../../../src/framework/cbim-runtime';
import {afterEach,expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createAgentCallAssembly} from '../../../../../src/logic/application/assembly/agent-calls';
import {createWorkspaceLoop} from '../../../../../src/logic/execution/assembly/loop-engine';
import {runtimeEngineTools} from '../../../../../src/logic/execution/rules/engine-tools';
import {FileRunStorage} from '../../../../../src/logic/execution/storage/run-storage';
import {GlobalRunAdmission} from '../../../../../src/logic/execution/admission/run-admission';
import {workspaceMemberModelHash} from '../../../../../src/logic/team/rules/workspace-member-rules';
import type {AgentEngine,EngineContext,TaskSpec,ToolDecision} from '../../../../../src/logic/execution/rules/types';
import type {AgentCallAssemblyInput} from '../../../../../src/logic/application/assembly/agent-calls';
import type {ResolvedEngineModel as ResolvedLlm} from '../../../../../src/logic/engines/index';
import type {RequestBudgetPort} from '../../../../../src/logic/budget/rules/request-budget';

// Only the external engine is replaced. Assembly, runtime, scheduler, logs and admission remain real.
const fake=vi.hoisted(()=>({engine:vi.fn()}));
vi.mock('../../../../../src/engine-plugins/pi/engine',()=>({PiEngine:class {constructor(options:unknown){return fake.engine(options)}}}));

vi.mock('../../../../../src/engine-plugins/claude/engine',()=>({ClaudeCodeEngine:class {constructor(options:unknown){return fake.engine(options)}}}));
vi.mock('../../../../../src/engine-plugins/codex/engine',()=>({CodexEngine:class {constructor(options:unknown){return fake.engine(options)}}}));

const cleanups:(()=>Promise<void>)[]=[];
afterEach(async()=>{for(const cleanup of cleanups.splice(0))await cleanup();fake.engine.mockReset()});

async function fixture(mode:'implicit-engine'|'chain'|'different-model'|'changed-capability'|'capacity'|'budget'|'legacy-budget'|'read'|'cross-model'|'cross-model-question'|'changed-model-capture'|'question'|'nested-question'|'unanswered'='chain'){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-agent-assembly-'));
  const storage=new FileRunStorage(),admission=new GlobalRunAdmission();
  const rootTask:TaskSpec={taskId:'root-task',workspaceId:'workspace',root:directory,mode:'chat',agentId:'cbim:main',goal:'root',moduleIds:[],acceptance:[]};
  const llm:ResolvedLlm={profile:{id:'profile',name:'Configured model',model:'model',api:'openai-completions',baseUrl:'https://example.invalid/v1',auth:'none',contextWindow:8192,maxTokens:1024,reasoning:false,...(mode==='implicit-engine'?{}:{engine:'pi' as const})},apiKey:''};
  const paths={Identity:async()=>({id:'workspace',path:directory}),Project:()=>directory};
  const workspace={entry:{id:'workspace',path:directory},instanceId:'instance',paths,rules:{designRoot:path.resolve('design')},Assert:vi.fn()};
  const modelB:ResolvedLlm={profile:{...llm.profile,id:'profile-b',model:'model-b',engine:'claude-code',api:'anthropic-messages',pricing:{input:2,output:4,cacheRead:1,cacheWrite:2}},apiKey:'child-key'};
  const modelC:ResolvedLlm={profile:{...llm.profile,id:'profile-c',model:'model-c',engine:'codex',api:'openai-responses',pricing:{input:3,output:6,cacheRead:1,cacheWrite:2}},apiKey:'leaf-key'};
  const target=(memberId:string)=>mode.startsWith('cross-model')?(memberId==='worker-b'?modelB:modelC):llm;
  const memberGet=vi.fn(async({memberId}:{memberId:string})=>({
    member:{memberId,name:memberId,state:'active',position:'Duty '+memberId,adaptation:{instructions:'Use only the requested scope',references:[]},
      adoption:{configuration:{agentId:'.cbim/team/'+memberId,principles:'Report evidence to the caller',effectiveSkills:[{skillId:'sk-'+memberId,ownerId:memberId,inherited:false,content:'Procedure '+memberId}]}},
      runtimePolicy:{profileId:target(memberId).profile.id,modelId:mode==='different-model'?'other-model':target(memberId).profile.model,engine:target(memberId).profile.engine,configurationHash:workspaceMemberModelHash(target(memberId).profile)}},
    currentDiff:{capability:{status:mode==='changed-capability'?'changed':'same'},model:{status:'same'}},
  }));
  const budgetPort={model:{},reserve:vi.fn(async()=>{
    if(mode==='budget')throw Object.assign(Error('Budget exhausted'),{code:'REQUEST_BUDGET_LIMIT'});
    return {requestId:'ticket',issue:async()=>{},assertSend:()=>{},report:async()=>{},unknown:async()=>{},notSent:async()=>{}};
  })} as unknown as RequestBudgetPort;
  const forRun=vi.fn(async(..._args:unknown[])=>budgetPort),holdRelease=vi.fn(),holdMain=vi.fn((_runId:string)=>holdRelease),openScope=vi.fn(async(..._args:unknown[])=>mode==='legacy-budget'?{budget:{policy:{enabled:true,enforcement:'reservation'}}}:{}),closeScope=vi.fn(async(..._args:unknown[])=>{});
  const events:EngineContext[]=[],results:unknown[]=[],decisions:ToolDecision[]=[],budgets:RequestBudgetPort[]=[];
  const rootPermit=admission.Attempt({workspaceId:'workspace',rootSessionId:rootTask.taskId,taskId:rootTask.taskId,scopeId:'root-scope',requestId:'root-request',ownerEpoch:1,source:'direct',workspacePermission:'read'},{CanAcquire:()=>undefined,Acquire:()=>()=>{},IsCurrent:()=>true});
  if(rootPermit.kind!=='granted')throw Error('Root admission failed');
  if(mode==='capacity')admission.Configure({revision:1,maxConcurrentRuns:1});
  const options={mode:'chat' as const,engine:'pi' as const,provider:'cbim-profile',profileId:'profile',model:'model',permission:mode==='read'?'read' as const:'execute' as const,process:{command:'test-engine',args:[]},llm};
  const input={office:new CbimRuntime().OpenOffice(workspace.entry.id,rootTask.taskId),workspace,task:rootTask,options,llm,storage,members:{Get:memberGet,List:async()=>({items:['worker-b','worker-c'].map(memberId=>({memberId,name:memberId,state:'active',teamId:'team',agentId:'.cbim/team/'+memberId,position:memberId})),registryCursor:'v1'})},admission:{manager:admission,ownerEpoch:1,IsCurrent:()=>true},dispatch:{budgets:{HoldMain: holdMain},OpenScope: openScope,CloseScope: closeScope},requestBudgets:{ForRun: forRun,Preflight:async()=>{}},...((mode.startsWith('cross-model')||mode==='changed-model-capture'||mode==='implicit-engine')?{models:{WithRuntimeConfiguration:async(ref:any,use:any)=>{const selected=[modelB,modelC,llm].find(m=>m.profile.id===ref.profileId)!;expect(ref).toMatchObject({modelId:selected.profile.model,engine:selected.profile.engine});return use({profile:{...structuredClone(selected.profile),...(mode==='changed-model-capture'?{maxTokens:selected.profile.maxTokens+1}:{})},Resolve:()=>structuredClone(selected)})}}}:{}),authorizeNative:async()=>({allow:true})} as unknown as AgentCallAssemblyInput;
  const assembly=createAgentCallAssembly(input);
  fake.engine.mockImplementation((engineOptions:any):AgentEngine=>{
    let context:EngineContext;
    return {kind:engineOptions.llm.profile.engine??'pi',start:async value=>{context=value;events.push(value);await context.emit({type:'session.bound',data:{sessionId:value.runId,sessionFile:path.join(value.directory,'native.jsonl')}})},run:async(message)=>{
      const port=await engineOptions.requestBudget?.();if(port){budgets.push(port);const ticket=await port.reserve({requestHash:'f'.repeat(64),maxOutputTokens:64});await ticket.issue();ticket.assertSend();}
      const tools=await runtimeEngineTools(context,engineOptions.knowledge);
      const names=(await tools.list()).map(tool=>tool.name);
      expect(names).toContain('cbim_agent_call');expect(names).not.toContain('cbim_dispatch_task');
      if(mode==='cross-model' && message!=='root'){
        const member=message==='child'?'worker-b':'worker-c';
        const call={id:'read-role-skill',name:'cbim_agent_skill_read',input:{skillId:'sk-'+member}};
        expect(names).toContain(call.name);
        expect((await context.beforeTool(call)).allow).toBe(true);
        const receipt:any=await tools.call(call.name,call.input,new AbortController().signal,call.id);
        const {position,skill}=JSON.parse(receipt.content[0].text);
        expect([position,skill.content]).toEqual(['Duty '+member,'Procedure '+member]);
        await context.emit({type:'tool.finished',data:{...call,result:receipt}});
        await context.emit({type:'message',data:{text:position+' / '+skill.content}});
      }
      const ask=async()=>{
        const call={id:'ask-parent',name:'cbim_ask_user_question',input:{questions:[{question:'Choose scope',options:[{label:'Small'},{label:'Large'}]}]}};
        expect((await context.beforeTool(call)).allow).toBe(true);
        const answer=await tools.call(call.name,call.input,new AbortController().signal,call.id);
        await context.emit({type:'tool.finished',data:{...call,result:answer}});expect(JSON.parse((answer as any).content[0].text)).toMatchObject({answers:[{answer:'Small'}]});
      };
      if(message==='leaf'){
        if(['question','nested-question','cross-model-question','unanswered'].includes(mode))await ask();
        if(mode==='read')decisions.push(await context.beforeTool({id:'child-write',name:'write',input:{path:path.join(directory,'not-written.txt'),content:'denied'}}));
        await context.emit({type:'message',data:{text:'Leaf evidence'}});
      }else{
        const call={id:'nested-call',name:'cbim_agent_call',input:{agentId:message==='root'?'worker-b':'worker-c',message:message==='root'?'child':'leaf'}};
        const allowed=await context.beforeTool(call);expect(allowed.allow).toBe(true);
        let result=await tools.call(call.name,call.input,new AbortController().signal,call.id);
        await context.emit({type:'tool.finished',data:{id:call.id,name:call.name,result}});
        const waiting=JSON.parse((result as any).content[0].text);
        if(waiting.status==='waiting'&&!(mode==='unanswered'&&message==='root')){
          if(['nested-question','unanswered'].includes(mode)&&message==='child')await ask();
          const forbidden=await context.beforeTool({id:'blocked-parent-write',name:'write',input:{path:'blocked.txt',content:'no'}});
          expect(forbidden.allow).toBe(false);
          const reply={id:'reply-child',name:'cbim_agent_reply',input:{callId:waiting.callId,questionId:waiting.questionId,result:{answers:[{question:'Choose scope',answer:'Small'}]}}};
          expect((await context.beforeTool(reply)).allow).toBe(true);
          result=await tools.call(reply.name,reply.input,new AbortController().signal,reply.id);
          await context.emit({type:'tool.finished',data:{...reply,result}});
        }
        results.push(result);
        await context.emit({type:'message',data:{text:message==='root'?'Root summary':'Child summary'}});
      }
      return {status:'completed'};
    },stop:async()=>{},close:async()=>{}};
  });
  const root=await createWorkspaceLoop(input.workspace.paths,input.workspace,options,{storage,rootAgent:assembly.rootAgent,AgentTools:assembly.AgentTools,RequestBudget:assembly.requestBudget,AcquireLease:async()=>()=>{},AuthorizeNative:input.authorizeNative});
  cleanups.push(async()=>{await root.runtime.Close();await assembly.agentLifecycle.Failed(Error('test cleanup'));rootPermit.release();const target=path.resolve(directory);if(path.dirname(target)!==path.resolve(os.tmpdir())||!path.basename(target).startsWith('cbim-agent-assembly-'))throw Error('Unexpected cleanup directory');await fs.rm(target,{recursive:true,force:true})});
  const run=async()=>{const result=await root.runtime.Start(rootTask,'root',undefined,undefined,{signal:new AbortController().signal,BeforeRun:({runId})=>assembly.agentLifecycle.BeforeRun(runId)});const summary=await result.done;await assembly.agentLifecycle.Settled(summary);return summary};
  return {rootTask,run,assembly,events,results,decisions,budgets,budgetPort,forRun,holdMain,holdRelease,openScope,closeScope,memberGet,admission,storage,directory};
}

it('routes root to child to grandchild through real loops, exact identities and one root budget',async()=>{
  const f=await fixture();const root=await f.run();
  expect(root.status).toBe('completed');expect(f.events).toHaveLength(3);expect(f.results).toHaveLength(2);
  expect(f.forRun).toHaveBeenCalledTimes(3);expect(f.budgets).toEqual([f.budgetPort,f.budgetPort,f.budgetPort]);
  expect(f.holdMain).toHaveBeenCalledTimes(1);expect(f.openScope).toHaveBeenCalledTimes(1);expect(f.closeScope).toHaveBeenCalledTimes(1);expect(f.holdRelease).toHaveBeenCalledTimes(1);
  const [a,b,c]=f.events;
  const child=await f.storage.Read(b.directory),leaf=await f.storage.Read(c.directory);
  expect(b.task.parentTaskId).toBe(a.task.taskId);
  expect(c.task.parentTaskId).toBe(b.task.taskId);
  expect(child.events[0].data.agentCall).toMatchObject({callerTaskId:a.task.taskId,callerRunId:a.runId,toolCallId:'nested-call',taskId:b.task.taskId,runId:b.runId});
  expect(leaf.events[0].data.agentCall).toMatchObject({callerTaskId:b.task.taskId,callerRunId:b.runId,toolCallId:'nested-call',taskId:c.task.taskId,runId:c.runId});
  expect(f.admission.Snapshot().occupied).toHaveLength(1);
  await f.assembly.agentLifecycle.Settled(root);expect(f.holdRelease).toHaveBeenCalledTimes(1);
});

it.each([['different-model','AGENT_MODEL_UNAVAILABLE'],['changed-model-capture','AGENT_CONFIGURATION_CHANGED'],['changed-capability','AGENT_CONFIGURATION_CHANGED'],['capacity','AGENT_CONCURRENCY_LIMIT'],['legacy-budget','AGENT_BUDGET_MODE_UNSUPPORTED']] as const)('rejects %s before creating a child runtime',async(mode,code)=>{
  const f=await fixture(mode);await f.run();
  expect(f.events).toHaveLength(1);expect(fake.engine).toHaveBeenCalledTimes(1);expect(f.results).toHaveLength(1);
  const wire=f.results[0] as {content:{type:string;text:string}[];isError?:boolean};expect(wire.isError).toBe(true);
  expect(JSON.parse(wire.content[0].text)).toMatchObject({error:{code,started:false}});
  if(mode==='capacity')expect(JSON.parse(wire.content[0].text).error).toMatchObject({current:1,limit:1,requested:1,unit:'process'});
  expect(f.admission.Snapshot().occupied).toHaveLength(1);expect(f.forRun).toHaveBeenCalledTimes(1);
});

it('does not let an inherited read-only Agent authorize a native write',async()=>{
  const f=await fixture('read');await f.run();expect(f.events).toHaveLength(3);expect(f.decisions).toHaveLength(1);expect(f.decisions[0].allow).toBe(false);
  await expect(fs.stat(path.join(f.directory,'not-written.txt'))).rejects.toMatchObject({code:'ENOENT'});
});

it('root request budget refusal prevents child startup and closes the root scope',async()=>{
  const f=await fixture('budget');const result=await f.run();
  expect(result.status).toBe('interrupted');expect(f.memberGet).not.toHaveBeenCalled();expect(f.events).toHaveLength(1);expect(f.holdRelease).toHaveBeenCalledTimes(1);
  expect(f.closeScope.mock.calls[0][2]).toBe('interrupted');expect(f.admission.Snapshot().occupied).toHaveLength(1);
});

it('uses different frozen engine/model selections and budgets for each level without changing root selection',async()=>{
 const f=await fixture('cross-model');expect((await f.run()).status).toBe('completed');expect(f.events).toHaveLength(3);
 const options=fake.engine.mock.calls.map(([options])=>options);
 expect(options[0].prompt).toContain('接收用户任务');
 for(const [i,id] of ['worker-b','worker-c'].entries()){expect(options[i+1].prompt).toContain('Duty '+id);expect(options[i+1].prompt).toContain('Procedure '+id);expect(options[i+1].prompt).toContain('Report evidence to the caller')}
 expect(options.map(o=>[o.llm.profile.engine,o.llm.profile.model,o.llm.apiKey])).toEqual([['pi','model',''],['claude-code','model-b','child-key'],['codex','model-c','leaf-key']]);
 expect(f.forRun.mock.calls.map(c=>(c[1] as ResolvedLlm).profile.model)).toEqual(['model','model-b','model-c']);
 expect(f.forRun.mock.calls[1][0]).toMatchObject({kind:'main',taskId:'root-task',agentRun:{taskId:f.events[1].task.taskId,runId:f.events[1].runId}});
 expect(f.admission.Snapshot().occupied).toHaveLength(1);
});
it.each(['question','nested-question','cross-model-question'] as const)('resumes the original task/run through %s without direct user input or a second engine',async mode=>{
 const f=await fixture(mode);expect((await f.run()).status).toBe('completed');expect(f.events).toHaveLength(3);expect(fake.engine).toHaveBeenCalledTimes(3);
 const records=await Promise.all(f.events.map(e=>f.storage.Read(e.directory)));
 expect(records[2].events.filter(e=>e.type==='run.started')).toHaveLength(1);
 expect(records[1].events.some(e=>e.data.agentCallState==='waiting')).toBe(true);
 expect(f.results.map((r:any)=>JSON.parse(r.content[0].text))).toMatchObject([{status:'completed'},{status:'completed'}]);
 expect(f.admission.Snapshot().occupied).toHaveLength(1);
});
it('an unanswered child cannot be silently completed; original subtree is cancelled and drained',async()=>{
 const f=await fixture('unanswered');const run=await f.run();expect(run.status).toBe('interrupted');expect(f.events).toHaveLength(3);expect(f.admission.Snapshot().occupied).toHaveLength(1);
});

it('preserves an implicit Pi engine in adopted model hashes during recursive capture',async()=>{
 const f=await fixture('implicit-engine');expect((await f.run()).status).toBe('completed');expect(f.events).toHaveLength(3);
 expect(f.results.map((r:any)=>JSON.parse(r.content[0].text).status)).toEqual(['completed','completed']);
});

it('binds root control tools only after admission and waits for the original commit before closure',async()=>{
 const f=await fixture();expect(f.assembly.MainToolContext(f.rootTask,'root-run')).toBeUndefined();
 await f.assembly.agentLifecycle.BeforeRun('root-run');
 const context=f.assembly.MainToolContext(f.rootTask,'root-run')!;expect(context.binding).toMatchObject({workspaceId:'workspace',rootSessionId:f.rootTask.taskId,runId:'root-run'});
 expect(f.assembly.MainToolContext({...f.rootTask,taskId:'foreign'},'root-run')).toBeUndefined();expect(f.assembly.MainToolContext(f.rootTask,'foreign-run')).toBeUndefined();
 let entered=false,resolve!:(value:string)=>void;const original=context.Track(async()=>{entered=true;return new Promise<string>(r=>{resolve=r})});
 await vi.waitFor(()=>expect(entered).toBe(true));const stopping=f.assembly.agentLifecycle.Failed(Error('stop'));await Promise.resolve();
 expect(f.closeScope).not.toHaveBeenCalled();expect(f.holdRelease).not.toHaveBeenCalled();expect(()=>context.AssertCurrent(new AbortController().signal)).toThrow();expect(()=>context.Track(async()=> 'new')).toThrow();
 resolve('original receipt');expect(await original).toBe('original receipt');await stopping;expect(f.closeScope).toHaveBeenCalledTimes(1);expect(f.holdRelease).toHaveBeenCalledTimes(1);expect(f.assembly.MainToolContext(f.rootTask,'root-run')).toBeUndefined();
});

it('隔离工作区与主会话并按宿主生命周期释放 Office', () => {
  const runtime = new CbimRuntime();
  const first = runtime.OpenOffice('a', 'main');
  const second = runtime.OpenOffice('a', 'second');
  const other = runtime.OpenOffice('b', 'main');
  expect(runtime.OpenOffice('a', 'main')).toBe(first);
  expect(second).not.toBe(first);
  expect(other).not.toBe(first);
  runtime.CloseWorkspace('a');
  expect(first.closed).toBe(true);
  expect(second.closed).toBe(true);
  expect(runtime.OpenOffice('b', 'main')).toBe(other);
  expect(runtime.OpenOffice('a', 'main')).not.toBe(first);
  runtime.Close();
  runtime.Close();
  expect(other.closed).toBe(true);
  expect(() => runtime.OpenOffice('a', 'main')).toThrow('已关闭');
});
