import {describe,it,expect,vi} from 'vitest';
import {TaskProgressTools,progressTool,progressToolSchemas} from '../src/backend/core/evidence/progress-tools';
import {memberToolOutputSchema,memberToolOutputSchemas,memberToolContract,isProgressEvidence,progressToolIdentitySchema,type MemberToolName,type MemberToolOutputBinding} from '../src/backend/core/tasks/member-tool-output';
import {taskProgressSchema} from '../src/backend/core/evidence/progress-schema';
import {toolReceiptSchema} from '../src/backend/core/tools/receipt-schema';
import {checkedJsonToolResult} from '../src/backend/core/tools/results';
import type {TaskProgress} from '../src/backend/core/evidence/progress';
import type {ToolReceipt} from '../src/backend/core/tools/types';
import type {WorkflowContractBinding} from '../src/backend/core/tasks/execution-context';

const identity={workspaceId:'workspace',taskId:'task',runId:'run'},now='2026-11-07T00:00:00.000Z',hash='a'.repeat(64);
const binding:MemberToolOutputBinding={...identity,teamId:'team',agentId:'agent',agentInstanceId:'instance',agentSessionId:'session',rootSessionId:'root',leaseEpoch:1,planRevision:1};
const plan={expectedVersion:0,goal:'实现原目标',acceptance:['读取真实成果'],reason:'沿目标执行',steps:[{id:'build',title:'实现并读取',owner:'执行成员'}]};
const receipt=(patch:Partial<ToolReceipt>={}):ToolReceipt=>({version:1,...identity,toolCallId:'read-result',toolName:'read',outcome:'succeeded',inputHash:hash,resultHash:hash,effects:['read'],scope:{kind:'workspace',workspaceId:identity.workspaceId},recordedAt:now,...patch});
const inspect=async(tools:TaskProgressTools)=>JSON.parse((await tools.call('cbim_task_inspect',{})).content[0].text);
const invalid=expect.objectContaining({code:'TOOL_OUTPUT_INVALID'});
function fixture(){const saved:TaskProgress[]=[];const tools=new TaskProgressTools(undefined,async next=>{saved.push(structuredClone(next))},{identity});return {tools,saved}}
const helpInput={kind:'missing_input' as const,reason:'缺少输入',question:'需要目标说明',attemptedToolCallIds:[]};
const checkpointInput={expectedTaskProgressVersion:1,baselineId:'baseline',reason:'交给主调度'};
const captureInput={expectedTaskProgressVersion:1,sourceToolCallIds:['read-result']};
const outputs={
  cbim_task_help:{state:'staged',help:{helpId:'help',toolCallId:'capture',binding,input:helpInput,requestedAt:now}},
  cbim_task_checkpoint:{state:'staged',checkpoint:{version:1,checkpointId:'checkpoint',toolCallId:'capture',binding,input:checkpointInput,knowledgeRevision:'knowledge',requestedAt:now,lastEffectSeq:0}},
  cbim_task_artifact_capture:{state:'captured',baseline:{version:1,baselineId:'baseline',captureToolCallId:'capture',binding,knowledgeRevision:'knowledge',progressVersion:1,capturedAt:now,lastEffectSeq:0,sourceCalls:[{toolCallId:'read-result',toolName:'read',allowedSeq:2,finishedSeq:3,inputHash:hash,resultHash:hash}],files:[{relativePath:'out.txt',byteLength:4,sha256:hash,sourceToolCallIds:['read-result']}]}}
};

describe('member tool output leaf contracts',()=>{
  it('keeps the existing safeId domain for every runtime identity without accepting unsafe path fragments',async()=>{
    for(const prefix of ['_','-']){
      const original={workspaceId:prefix+'workspace',taskId:prefix+'task',runId:prefix+'run'};
      expect(progressToolIdentitySchema.safeParse(original).success).toBe(true);
      const tools=new TaskProgressTools(undefined,async()=>{},{identity:original});expect(await inspect(tools)).toEqual({plan:null,evidence:[]});
      await tools.call('cbim_task_plan',plan);tools.record(receipt({...original,scope:{kind:'workspace',workspaceId:original.workspaceId}}),tools.generation);expect((await inspect(tools)).evidence).toHaveLength(1);
    }
    for(const key of ['workspaceId','taskId','runId'] as const){
      expect(progressToolIdentitySchema.safeParse({...identity,[key]:'a'.repeat(100)}).success).toBe(true);
      for(const value of ['', 'a'.repeat(101), '../run', 'part/run', 'part\\run', 'name:stream', ' leading', 'trailing ', 'line\n', '中文', null, 1]){
        const invalidIdentity={...identity,[key]:value};expect(progressToolIdentitySchema.safeParse(invalidIdentity).success).toBe(false);
        expect(()=>new TaskProgressTools(undefined,async()=>{},{identity:invalidIdentity as typeof identity})).toThrow(expect.objectContaining({code:'TASK_PROGRESS_IDENTITY'}));
      }
    }
    expect(progressToolIdentitySchema.safeParse({...identity,scopeId:'unrequested'}).success).toBe(false);
  });
  it('publishes seven real contracts, keeps maintenance classification and rejects prototype names',()=>{
    expect(Object.keys(memberToolOutputSchemas)).toHaveLength(7);
    for(const name of Object.keys(memberToolOutputSchemas) as MemberToolName[]){const info=memberToolContract(name);expect(info.effects).toEqual(['maintenance']);expect(info.version).toBe(1);expect(info.outputSchema).toBeTruthy();expect(info.recovery.mode).not.toBe('retry_safe')}
    expect(progressToolSchemas).toHaveLength(4);expect(progressTool('cbim_task_inspect',{})?.effects).toEqual(['maintenance']);
    for(const name of ['constructor','toString','__proto__','cbim_task_missing'])expect(progressTool(name,{})).toBeUndefined();
    for(const name of ['cbim_task_help','cbim_task_checkpoint'] as const)expect(memberToolContract(name).recovery.queryTool).toBeUndefined();
  });
  it('keeps historical receipts readable but requires a real hashed result and matching identity for current evidence',()=>{
    const legacy={...receipt(),toolName:'',resultHash:undefined,effects:[]};expect(toolReceiptSchema.safeParse(legacy).success).toBe(true);expect(isProgressEvidence(legacy,identity)).toBe(false);
    for(const bad of [receipt({resultHash:undefined}),receipt({toolName:' '}),receipt({workspaceId:'other'}),receipt({taskId:'other'}),receipt({runId:'other'}),receipt({scope:{kind:'workspace',workspaceId:'other'}}),receipt({outcome:'failed'}),receipt({resultHash:'not-a-hash'})])expect(isProgressEvidence(bad,identity)).toBe(false);
    for(const name of ['cbim_task_inspect','cbim_dispatch_task','cbim_goal_review','cbim_governance_get','cbim_repository_get','cbim_delivery_prepare'])expect(isProgressEvidence(receipt({toolName:name}),identity)).toBe(false);
    expect(isProgressEvidence(receipt(),identity)).toBe(true);
  });
  it.each(Object.keys(outputs) as (keyof typeof outputs)[])('%s checks all binding fields, exact input and actual call without rewriting',name=>{
    const input=name==='cbim_task_help'?helpInput:name==='cbim_task_checkpoint'?checkpointInput:captureInput;
    const schema=memberToolOutputSchema(name,{binding,input,toolCallId:'capture',knowledgeRevision:'knowledge'});
    expect(JSON.parse(checkedJsonToolResult(name,outputs[name],schema).content[0].text)).toEqual(outputs[name]);
    const field=name==='cbim_task_help'?'help':name==='cbim_task_checkpoint'?'checkpoint':'baseline';
    for(const key of Object.keys(binding)){
      const bad=structuredClone(outputs[name]) as any;bad[field].binding[key]=typeof bad[field].binding[key]==='number'?99:'other';
      expect(()=>checkedJsonToolResult(name,bad,schema)).toThrow(invalid);
    }
    const bad=structuredClone(outputs[name]) as any;bad[field][name==='cbim_task_artifact_capture'?'captureToolCallId':'toolCallId']='other';expect(()=>checkedJsonToolResult(name,bad,schema)).toThrow(invalid);
    expect(()=>checkedJsonToolResult(name,{...outputs[name],approved:true},schema)).toThrow(invalid);
    expect(()=>checkedJsonToolResult(name,{state:'completed'},schema)).toThrow(invalid);
    expect(()=>checkedJsonToolResult(name,outputs[name],memberToolOutputSchema(name,{binding,input:{...input,...(name==='cbim_task_artifact_capture'?{sourceToolCallIds:['other']}:{reason:'changed'})},toolCallId:'capture'}))).toThrow(invalid);
  });
  it('checks trusted staged help identity/time and captured knowledge/version without inventing terminal facts',()=>{
    const help=outputs.cbim_task_help,schema=memberToolOutputSchema('cbim_task_help',{binding,input:helpInput,toolCallId:'capture',expectedStaged:structuredClone(help.help)});
    expect(()=>checkedJsonToolResult('cbim_task_help',{...help,help:{...help.help,helpId:'different'}},schema)).toThrow(invalid);
    expect(()=>checkedJsonToolResult('cbim_task_help',{...help,help:{...help.help,requestedAt:'2026-11-07T00:00:01.000Z'}},schema)).toThrow(invalid);
    for(const patch of [{knowledgeRevision:'changed'},{progressVersion:2}])expect(()=>checkedJsonToolResult('cbim_task_artifact_capture',{state:'captured',baseline:{...outputs.cbim_task_artifact_capture.baseline,...patch}},memberToolOutputSchema('cbim_task_artifact_capture',{binding,input:captureInput,toolCallId:'capture',knowledgeRevision:'knowledge'}))).toThrow(invalid);
  });
  it('strict plan state accepts original facts only, not added identities, completion or missing fields',async()=>{
    const {tools}=fixture();expect(await inspect(tools)).toEqual({plan:null,evidence:[]});await tools.call('cbim_task_plan',plan);const current=tools.current()!;
    expect(taskProgressSchema.safeParse(current).success).toBe(true);
    for(const bad of [{...current,workspaceId:'workspace'},{...current,goal:undefined},{...current,state:'completed'},{...current,delivery:{summary:'fake',limitations:[]}},{...current,steps:[{...current.steps[0],state:'reported_done'}]}])expect(taskProgressSchema.safeParse(bad).success).toBe(false);
  });
  it('reconstructs the requested plan rather than trusting a mutated expected-result alias',async()=>{
    const {tools}=fixture();await tools.call('cbim_task_plan',plan);const changed={...tools.current()!,goal:'替换原目标'};
    const schema=memberToolOutputSchema('cbim_task_plan',{binding:identity,input:plan,progress:{expected:changed,evidence:[]}});
    expect(()=>checkedJsonToolResult('cbim_task_plan',changed,schema)).toThrow(invalid);
  });
});

describe('progress saved output does not authorize retries',()=>{
  it.each(['cbim_task_plan','cbim_task_step','cbim_delivery_prepare'] as const)('%s keeps the actual saved revision after a corrupt return',async name=>{
    const {tools,saved}=fixture();let input:unknown=plan;
    if(name!=='cbim_task_plan'){await tools.call('cbim_task_plan',plan);tools.record(receipt(),tools.generation);input={expectedVersion:1,id:'build',state:'reported_done',evidenceIds:['read-result']}}
    if(name==='cbim_delivery_prepare'){await tools.call('cbim_task_step',input);input={expectedVersion:2,summary:'真实候选',limitations:[]}}
    const target=tools as unknown as {persist(next:TaskProgress):Promise<TaskProgress>},persist=target.persist.bind(tools),before=saved.length;
    vi.spyOn(target,'persist').mockImplementationOnce(async next=>({...await persist(next),goal:'错误回包中替换的目标'}));
    await expect(tools.call(name,input)).rejects.toThrow(invalid);expect(saved).toHaveLength(before+1);expect(tools.current()).toEqual(saved.at(-1));
    expect((await inspect(tools)).plan).toEqual(saved.at(-1));await expect(tools.call(name,input)).rejects.toThrow('版本');expect(saved).toHaveLength(before+1);
  });
  it('freezes original input and memory state before a save callback mutates its argument',async()=>{
    const saved:TaskProgress[]=[];const tools=new TaskProgressTools(undefined,async next=>{saved.push(structuredClone(next));next.version=0;next.goal='changed-after-save'},{identity});
    await expect(tools.call('cbim_task_plan',plan)).rejects.toThrow(invalid);
    expect(tools.current()).toEqual(saved[0]);expect((await inspect(tools)).plan.version).toBe(1);await expect(tools.call('cbim_task_plan',plan)).rejects.toThrow('版本');expect(saved).toHaveLength(1);
  });
  it('serializes the original saved return exactly once and never hides serialization errors or secrets',async()=>{
    const {tools,saved}=fixture(),target=tools as unknown as {persist(next:TaskProgress):Promise<TaskProgress>},persist=target.persist.bind(tools);let serializations=0;
    vi.spyOn(target,'persist').mockImplementationOnce(async next=>{const committed=await persist(next);return {toJSON(){serializations++;return {...committed,secret:'private-output'}}} as unknown as TaskProgress});
    const error=await tools.call('cbim_task_plan',plan).catch(error=>error);expect(error).toMatchObject({code:'TOOL_OUTPUT_INVALID'});expect(error.message).not.toContain('private-output');expect(serializations).toBe(1);expect(saved).toHaveLength(1);expect(tools.current()).toEqual(saved[0]);
    vi.spyOn(target,'persist').mockImplementationOnce(async next=>{await persist(next);return {toJSON(){throw Error('private-serialization')}} as unknown as TaskProgress});
    const error2=await tools.call('cbim_task_plan',{...plan,expectedVersion:1}).catch(error=>error);expect(error2).toMatchObject({code:'TOOL_OUTPUT_INVALID'});expect(error2.message).not.toContain('private-serialization');expect(saved).toHaveLength(2);
  });
  it('does not clone or pre-parse an artifact port result and checks only its one original wire',async()=>{
    let serializations=0;const artifacts={toJSON(){serializations++;return [{baselineId:'bad',unknown:'secret'}]}};
    const tools=new TaskProgressTools(undefined,async()=>{},{identity,artifacts:()=>artifacts as any});
    await expect(tools.call('cbim_task_inspect',{})).rejects.toThrow(invalid);expect(serializations).toBe(1);expect(tools.current()).toBeUndefined();
    const good=new TaskProgressTools(undefined,async()=>{},{identity,artifacts:()=>({toJSON(){return []}} as any)});expect(await inspect(good)).toEqual({plan:null,evidence:[],artifacts:[]});
    const missing=new TaskProgressTools(undefined,async()=>{},{identity,artifacts:()=>undefined as any});await expect(missing.call('cbim_task_inspect',{})).rejects.toThrow(invalid);
  });
  it('keeps cross-run/hashless/internal receipts out and isolates accepted receipt values from later mutation',async()=>{
    const {tools}=fixture();await tools.call('cbim_task_plan',plan);
    for(const bad of [receipt({runId:'old'}),receipt({scope:{kind:'knowledge',workspaceId:'other'}}),receipt({resultHash:undefined}),receipt({toolName:''})])tools.record(bad,tools.generation);
    expect((await inspect(tools)).evidence).toEqual([]);await expect(tools.call('cbim_task_step',{expectedVersion:1,id:'build',state:'reported_done',evidenceIds:['read-result']})).rejects.toThrow('证据');
    const source=receipt();tools.record(source,tools.generation);source.runId='tampered';source.scope.workspaceId='other';expect((await inspect(tools)).evidence).toEqual([receipt()]);
  });
  it('preserves the persisted all-module Workflow proof while rejecting a return with an omitted condition',async()=>{
    const bindings:WorkflowContractBinding[]=['module-a','module-b'].map(moduleId=>({moduleId,workflowId:moduleId+'/workflow',workflowVersion:'body-hash',contract:{version:1,delivery:{requiredToolEvidence:[{id:'read-result',toolName:'read'}]}}}));
    const saved:TaskProgress[]=[],tools=new TaskProgressTools(undefined,async next=>{saved.push(structuredClone(next))},{identity,workflow:{bindings,identity,task:{goal:plan.goal,acceptance:plan.acceptance}}});
    await tools.call('cbim_task_plan',plan);tools.record(receipt(),tools.generation);await tools.call('cbim_task_step',{expectedVersion:1,id:'build',state:'reported_done',evidenceIds:['read-result']});
    const target=tools as unknown as {persist(next:TaskProgress):Promise<TaskProgress>},persist=target.persist.bind(tools);
    vi.spyOn(target,'persist').mockImplementationOnce(async next=>{const result=structuredClone(await persist(next));result.delivery!.workflow!.checks.pop();return result});
    await expect(tools.call('cbim_delivery_prepare',{expectedVersion:2,summary:'两模块候选',limitations:[]})).rejects.toThrow(invalid);
    expect(saved.at(-1)?.delivery?.workflow?.checks).toHaveLength(2);expect(tools.current()).toEqual(saved.at(-1));expect((await inspect(tools)).workflowContracts).toEqual(bindings);
  });
});
