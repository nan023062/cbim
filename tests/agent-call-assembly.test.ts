import {afterEach,expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createAgentCallAssembly} from '../src/logic/application/assembly/agent-calls';
import {createWorkspaceLoop} from '../src/logic/execution/assembly/loop-engine';
import {runtimeEngineTools} from '../src/logic/execution/rules/engine-tools';
import {FileRunStorage} from '../src/logic/execution/storage/run-storage';
import {GlobalRunAdmission} from '../src/logic/execution/admission/run-admission';
import {workspaceMemberModelHash} from '../src/logic/team/rules/workspace-member-rules';
import type {AgentEngine,EngineContext,TaskSpec,ToolDecision} from '../src/logic/execution/rules/types';
import type {AgentCallAssemblyInput} from '../src/logic/application/assembly/agent-calls';
import type {ResolvedLlm} from '../src/logic/models';
import type {RequestBudgetPort} from '../src/logic/budget/rules/request-budget';

// Only the external engine is replaced. Assembly, runtime, scheduler, logs and admission remain real.
const fake=vi.hoisted(()=>({engine:vi.fn()}));
vi.mock('../src/logic/execution/engines/pi/engine',()=>({PiEngine:class {constructor(options:unknown){return fake.engine(options)}}}));

const cleanups:(()=>Promise<void>)[]=[];
afterEach(async()=>{for(const cleanup of cleanups.splice(0))await cleanup();fake.engine.mockReset()});

async function fixture(mode:'chain'|'different-model'|'changed-capability'|'capacity'|'budget'|'legacy-budget'|'read'='chain'){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-agent-assembly-'));
  const storage=new FileRunStorage(),admission=new GlobalRunAdmission();
  const rootTask:TaskSpec={taskId:'root-task',workspaceId:'workspace',root:directory,mode:'chat',agentId:'cbim:main',goal:'root',moduleIds:[],acceptance:[]};
  const llm:ResolvedLlm={profile:{id:'profile',name:'Configured model',model:'model',api:'openai-completions',baseUrl:'https://example.invalid/v1',auth:'none',contextWindow:8192,maxTokens:1024,reasoning:false,engine:'pi'},apiKey:''};
  const paths={identity:async()=>({id:'workspace',path:directory}),project:()=>directory};
  const workspace={entry:{id:'workspace',path:directory},instanceId:'instance',paths,rules:{designRoot:path.resolve('design')},assert:vi.fn()};
  const profileHash=workspaceMemberModelHash(llm.profile),memberGet=vi.fn(async({memberId}:{memberId:string})=>({
    member:{memberId,name:memberId,state:'active',adaptation:{instructions:'Use only the requested scope'},
      adoption:{configuration:{agentId:'.cbim/team/'+memberId,principles:'Report evidence to the caller',effectiveSkills:[]}},
      runtimePolicy:{profileId:'profile',modelId:mode==='different-model'?'other-model':'model',engine:'pi',configurationHash:profileHash}},
    currentDiff:{capability:{status:mode==='changed-capability'?'changed':'same'},model:{status:'same'}},
  }));
  const budgetPort={model:{},reserve:vi.fn(async()=>{
    if(mode==='budget')throw Object.assign(Error('Budget exhausted'),{code:'REQUEST_BUDGET_LIMIT'});
    return {requestId:'ticket',issue:async()=>{},assertSend:()=>{},report:async()=>{},unknown:async()=>{},notSent:async()=>{}};
  })} as unknown as RequestBudgetPort;
  const forRun=vi.fn(async(..._args:unknown[])=>budgetPort),holdRelease=vi.fn(),holdMain=vi.fn((_runId:string)=>holdRelease),openScope=vi.fn(async(..._args:unknown[])=>mode==='legacy-budget'?{budget:{policy:{enabled:true,enforcement:'reservation'}}}:{}),closeScope=vi.fn(async(..._args:unknown[])=>{});
  const events:EngineContext[]=[],results:unknown[]=[],decisions:ToolDecision[]=[],budgets:RequestBudgetPort[]=[];
  const rootPermit=admission.attempt({workspaceId:'workspace',rootSessionId:rootTask.taskId,taskId:rootTask.taskId,scopeId:'root-scope',requestId:'root-request',ownerEpoch:1,source:'direct',workspacePermission:'read'},{canAcquire:()=>undefined,acquire:()=>()=>{},isCurrent:()=>true});
  if(rootPermit.kind!=='granted')throw Error('Root admission failed');
  if(mode==='capacity')admission.configure({revision:1,maxConcurrentRuns:1});
  const options={mode:'chat' as const,engine:'pi' as const,provider:'cbim-profile',profileId:'profile',model:'model',permission:mode==='read'?'read' as const:'execute' as const,process:{command:'test-engine',args:[]},llm};
  const input={workspace,task:rootTask,options,llm,storage,members:{get:memberGet},admission:{manager:admission,ownerEpoch:1,isCurrent:()=>true},dispatch:{budgets:{holdMain},openScope,closeScope},requestBudgets:{forRun},authorizeNative:async()=>({allow:true})} as unknown as AgentCallAssemblyInput;
  const assembly=createAgentCallAssembly(input);
  fake.engine.mockImplementation((engineOptions:any):AgentEngine=>{
    let context:EngineContext;
    return {kind:'pi',start:async value=>{context=value;events.push(value);await context.emit({type:'session.bound',data:{sessionId:value.runId,sessionFile:path.join(value.directory,'native.jsonl')}})},run:async(message)=>{
      const port=await engineOptions.requestBudget?.();if(port){budgets.push(port);const ticket=await port.reserve({requestHash:'f'.repeat(64),maxOutputTokens:64});await ticket.issue();ticket.assertSend();}
      const tools=await runtimeEngineTools(context,engineOptions.knowledge);
      const names=(await tools.list()).map(tool=>tool.name);
      expect(names).toContain('cbim_agent_call');expect(names).not.toContain('cbim_dispatch_task');
      if(message==='leaf'){
        if(mode==='read')decisions.push(await context.beforeTool({id:'child-write',name:'write',input:{path:path.join(directory,'not-written.txt'),content:'denied'}}));
        await context.emit({type:'message',data:{text:'Leaf evidence'}});
      }else{
        const call={id:'nested-call',name:'cbim_agent_call',input:{agentId:message==='root'?'worker-b':'worker-c',message:message==='root'?'child':'leaf'}};
        const allowed=await context.beforeTool(call);expect(allowed.allow).toBe(true);
        const result=await tools.call(call.name,call.input,new AbortController().signal,call.id);results.push(result);
        await context.emit({type:'tool.finished',data:{id:call.id,name:call.name,result}});
        await context.emit({type:'message',data:{text:message==='root'?'Root summary':'Child summary'}});
      }
      return {status:'completed'};
    },stop:async()=>{},close:async()=>{}};
  });
  const root=await createWorkspaceLoop(input.workspace.paths,input.workspace,options,{storage,rootAgent:assembly.rootAgent,agentTools:assembly.agentTools,requestBudget:assembly.requestBudget,acquireLease:async()=>()=>{},authorizeNative:input.authorizeNative});
  cleanups.push(async()=>{await root.runtime.close();await assembly.agentLifecycle.failed(Error('test cleanup'));rootPermit.release();const target=path.resolve(directory);if(path.dirname(target)!==path.resolve(os.tmpdir())||!path.basename(target).startsWith('cbim-agent-assembly-'))throw Error('Unexpected cleanup directory');await fs.rm(target,{recursive:true,force:true})});
  const run=async()=>{const result=await root.runtime.start(rootTask,'root',undefined,undefined,{signal:new AbortController().signal,beforeRun:({runId})=>assembly.agentLifecycle.beforeRun(runId)});const summary=await result.done;await assembly.agentLifecycle.settled(summary);return summary};
  return {run,assembly,events,results,decisions,budgets,budgetPort,forRun,holdMain,holdRelease,openScope,closeScope,memberGet,admission,storage,directory};
}

it('routes root to child to grandchild through real loops, exact identities and one root budget',async()=>{
  const f=await fixture();const root=await f.run();
  expect(root.status).toBe('completed');expect(f.events).toHaveLength(3);expect(f.results).toHaveLength(2);
  expect(f.forRun).toHaveBeenCalledTimes(1);expect(f.budgets).toEqual([f.budgetPort,f.budgetPort,f.budgetPort]);
  expect(f.holdMain).toHaveBeenCalledTimes(1);expect(f.openScope).toHaveBeenCalledTimes(1);expect(f.closeScope).toHaveBeenCalledTimes(1);expect(f.holdRelease).toHaveBeenCalledTimes(1);
  const [a,b,c]=f.events;
  const child=await f.storage.read(b.directory),leaf=await f.storage.read(c.directory);
  expect(child.events[0].data.agentCall).toMatchObject({callerTaskId:a.task.taskId,callerRunId:a.runId,toolCallId:'nested-call',taskId:b.task.taskId,runId:b.runId});
  expect(leaf.events[0].data.agentCall).toMatchObject({callerTaskId:b.task.taskId,callerRunId:b.runId,toolCallId:'nested-call',taskId:c.task.taskId,runId:c.runId});
  expect(f.admission.snapshot().occupied).toHaveLength(1);
  await f.assembly.agentLifecycle.settled(root);expect(f.holdRelease).toHaveBeenCalledTimes(1);
});

it.each([['different-model','AGENT_MODEL_UNSUPPORTED'],['changed-capability','AGENT_CONFIGURATION_CHANGED'],['capacity','AGENT_CONCURRENCY_LIMIT'],['legacy-budget','AGENT_BUDGET_MODE_UNSUPPORTED']] as const)('rejects %s before creating a child runtime',async(mode,code)=>{
  const f=await fixture(mode);await f.run();
  expect(f.events).toHaveLength(1);expect(fake.engine).toHaveBeenCalledTimes(1);expect(f.results).toHaveLength(1);
  const wire=f.results[0] as {content:{type:string;text:string}[];isError?:boolean};expect(wire.isError).toBe(true);
  expect(JSON.parse(wire.content[0].text)).toMatchObject({error:{code,started:false}});
  expect(f.admission.snapshot().occupied).toHaveLength(1);expect(f.forRun).toHaveBeenCalledTimes(1);
});

it('does not let an inherited read-only Agent authorize a native write',async()=>{
  const f=await fixture('read');await f.run();expect(f.events).toHaveLength(3);expect(f.decisions).toHaveLength(1);expect(f.decisions[0].allow).toBe(false);
  await expect(fs.stat(path.join(f.directory,'not-written.txt'))).rejects.toMatchObject({code:'ENOENT'});
});

it('root request budget refusal prevents child startup and closes the root scope',async()=>{
  const f=await fixture('budget');const result=await f.run();
  expect(result.status).toBe('interrupted');expect(f.memberGet).not.toHaveBeenCalled();expect(f.events).toHaveLength(1);expect(f.holdRelease).toHaveBeenCalledTimes(1);
  expect(f.closeScope.mock.calls[0][2]).toBe('interrupted');expect(f.admission.snapshot().occupied).toHaveLength(1);
});
