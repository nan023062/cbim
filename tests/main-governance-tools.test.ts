import {it,expect,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fixture} from './helpers';
import {request} from './data/knowledge';
import {seedModuleGovernance,moduleGovernanceFixture as data} from './module-governance-fixture';
import {mainGovernanceTools} from '../src/backend/main/governance/main-governance-tools';
import {GovernanceTools} from '../src/backend/scheduler-engine/tools/governance-tools';
import {governanceGetOutputSchema,governanceWriteOutputSchema,governanceReceiptOutputSchema,type GovernanceToolsPort} from '../src/backend/core/governance/module-governance-tools';
import type {TaskSpec} from '../src/backend/core/tasks/types';
import {moduleGovernanceMainCommandId} from '../src/backend/core/governance/module-governance-rules';
import {authorizeRunTool} from '../src/backend/core/tools/policy/tool-policy';

const signal=()=>new AbortController().signal;
const deferred=()=>{let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done});return {promise,resolve}};
async function setup(oversized=false){const f=await fixture();try{
  const seeded=await seedModuleGovernance(f.app,f.a),ws=f.app.workspace(seeded.entry.id);
  if(oversized)await ws.commit(request(await ws.snapshot(),[{path:seeded.overviewPath,text:seeded.original.replace('管理资源。','管理资源。\n\n'+'长正文'.repeat(6000))}]));
  const snapshot=await ws.snapshot(),registered=await f.app.dispatch('governance.register',{...seeded.identity,commandId:randomUUID(),moduleId:data.moduleId,expectedKnowledgeRevision:snapshot.revision});
  const task:TaskSpec={taskId:randomUUID(),workspaceId:seeded.entry.id,root:f.a,mode:'chat',agentId:'cbim:main',goal:'核实模块治理',moduleIds:[],acceptance:[]},binding=await f.app.memberDispatch(seeded.entry.id).conversationBinding(task),runId=randomUUID();
  const port=mainGovernanceTools(ws,task,runId,binding),tools=new GovernanceTools(port,{...binding,runId});
  const observe={protectionId:registered.record.protectionId,expectedProtectionRevision:1,expectedKnowledgeRevision:snapshot.revision,statement:data.observation};
  const parse=(result:{content:{text:string}[]})=>JSON.parse(result.content[0].text);
  const call=async(name:string,input:unknown,id:string,abort=signal())=>parse(await tools.call(name,input,abort,id));
  const propose=(observationId:string)=>({...observe,observationId,newOverviewText:seeded.proposed,reason:data.reason,alternatives:[data.alternative],invariants:[data.invariant],rollbackNotes:data.recovery});
  const proposalInput=(observationId:string)=>{const {statement:_,...input}=propose(observationId);return input};
  return {...f,...seeded,ws,snapshot,task,binding,runId,port,tools,observe,call,proposalInput,ledger:path.join(f.user,seeded.entry.id,'governance','module-ledger.json')};
}catch(error){await f.cleanup();throw error}}

it('真实主来源记录、严格范围和完整正文读取；原命令幂等且不写正式知识',async()=>{
  const f=await setup();try{
    expect(f.tools.list().map(tool=>tool.name)).toEqual(['cbim_governance_get','cbim_governance_observe','cbim_governance_propose','cbim_governance_receipt']);
    const before=await f.ws.snapshot(),directory=governanceGetOutputSchema.parse(await f.call('cbim_governance_get',{moduleId:data.moduleId},'directory'));expect(directory.observations.total).toBe(0);
    const observed=governanceWriteOutputSchema.parse(await f.call('cbim_governance_observe',f.observe,'observation'));expect(observed.status).toBe('recorded');if(observed.status!=='recorded'||observed.action!=='observe')throw Error('receipt');
    expect(observed.record.origin).toEqual({kind:'main_agent',rootSessionId:f.task.taskId,agentInstanceId:f.binding.agentInstanceId,agentSessionId:f.binding.agentSessionId,runId:f.runId,toolCallId:'observation',toolName:'cbim_governance_observe'});
    expect(await f.call('cbim_governance_observe',f.observe,'observation')).toEqual(observed);
    const selected=governanceGetOutputSchema.parse(await f.call('cbim_governance_get',{moduleId:data.moduleId,observationId:observed.commandId},'selected'));expect(selected.selectedObservation?.body).toMatchObject({state:'complete',text:f.original});
    const input=f.proposalInput(observed.commandId),proposed=governanceWriteOutputSchema.parse(await f.call('cbim_governance_propose',input,'proposal'));expect(proposed.status).toBe('recorded');
    expect(await f.call('cbim_governance_receipt',{action:'propose',toolCallId:'proposal'},'lookup')).toEqual(proposed);
    await expect(f.call('cbim_governance_propose',{...input,reason:'其他理由'},'proposal')).rejects.toMatchObject({code:'GOVERNANCE_COMMAND_CONFLICT'});
    expect((await f.ws.snapshot()).files).toEqual(before.files);
    await expect(f.ws.commit(request(before,[{path:f.overviewPath,text:f.proposed}]))).rejects.toMatchObject({code:'GOVERNANCE_PROTECTED'});
    const descriptor=f.tools.describe('cbim_governance_propose',input),approve=vi.fn(),guard=vi.fn();expect(descriptor).toEqual({effects:['preview'],native:false,scope:{kind:'knowledge',workspaceId:f.entry.id}});
    expect(await authorizeRunTool({id:'proposal',name:'cbim_governance_propose',input},descriptor,{workspaceId:f.entry.id,permission:'ask',guard,approve})).toMatchObject({allow:true,scope:{kind:'knowledge'}});expect(approve).not.toHaveBeenCalled();
  }finally{await f.cleanup()}
});

it('原始输入额外身份字段在任何业务调用前拒绝，显式缺失记录不切换为最新',async()=>{
  const f=await setup();try{
    const get=vi.spyOn(f.port,'get'),observe=vi.spyOn(f.port,'observe');
    expect(()=>f.tools.describe('cbim_governance_get',{moduleId:data.moduleId,actor:{kind:'local_desktop'}})).toThrow();
    await expect(f.call('cbim_governance_get',{moduleId:data.moduleId,workspaceId:f.entry.id},'invalid')).rejects.toMatchObject({code:'GOVERNANCE_INPUT'});
    await expect(f.call('cbim_governance_observe',{...f.observe,commandId:randomUUID()},'invalid')).rejects.toMatchObject({code:'GOVERNANCE_INPUT'});expect(get).not.toHaveBeenCalled();expect(observe).not.toHaveBeenCalled();
    await expect(f.call('cbim_governance_get',{moduleId:data.moduleId,observationId:randomUUID()},'missing')).rejects.toMatchObject({code:'GOVERNANCE_IDENTITY'});
    expect(f.tools.has('cbim_governance_apply')).toBe(false);expect(f.tools.has('cbim_governance_decide')).toBe(false);
  }finally{vi.restoreAllMocks();await f.cleanup()}
});

it('回执与观察不能跨根冒领；桌面来源只读可见但不是主模型写提案来源',async()=>{
  const f=await setup();try{
    const observed=await f.call('cbim_governance_observe',f.observe,'original'),otherTask={...f.task,taskId:randomUUID()},otherBinding=await f.app.memberDispatch(f.entry.id).conversationBinding(otherTask),other=mainGovernanceTools(f.ws,otherTask,randomUUID(),otherBinding);
    await expect(other.receipt({commandId:observed.commandId},signal())).rejects.toMatchObject({code:'GOVERNANCE_IDENTITY'});
    await expect(other.propose(f.proposalInput(observed.commandId),'cross',signal())).rejects.toMatchObject({code:'GOVERNANCE_SOURCE'});
    const desktop=await f.app.dispatch('governance.observe',{...f.identity,...f.observe,commandId:randomUUID()});expect(desktop.record.origin).toEqual({kind:'local_desktop',interaction:'explicit_submit'});
    await expect(f.port.propose(f.proposalInput(desktop.commandId),'desktop-source',signal())).rejects.toMatchObject({code:'GOVERNANCE_SOURCE'});
    expect(()=>mainGovernanceTools(f.ws,{...f.task,agentId:'cbim:executor'},f.runId,f.binding)).toThrow();
  }finally{await f.cleanup()}
});

it('提案预览仍在途时停止：保存前复核 signal，未追加提案且未改知识',async()=>{
  const f=await setup(),entered=deferred(),release=deferred();try{
    const observed=await f.call('cbim_governance_observe',f.observe,'observation'),before=await fs.readFile(f.ledger),store=(f.ws as any).knowledge,draft=store.draft.bind(store),control=new AbortController();
    const spy=vi.spyOn(store,'draft').mockImplementation(async(...args:any[])=>{const value=await draft(...args);entered.resolve();await release.promise;return value});
    const pending=f.call('cbim_governance_propose',f.proposalInput(observed.commandId),'cancel-proposal',control.signal);await entered.promise;control.abort();release.resolve();
    await expect(pending).rejects.toMatchObject({code:'GOVERNANCE_CANCELLED'});spy.mockRestore();expect(await fs.readFile(f.ledger)).toEqual(before);
    expect(await f.port.receipt({action:'propose',toolCallId:'cancel-proposal'},signal())).toMatchObject({status:'unknown'});expect((await f.ws.snapshot()).revision).toBe(f.snapshot.revision);
  }finally{release.resolve();vi.restoreAllMocks();await f.cleanup()}
});

it('持久化后回复丢失仍查原命令，重开查询不改账本且旧运行闭包失效',async()=>{
  const f=await setup();try{
    const append=f.ws.governance.store.append.bind(f.ws.governance.store),spy=vi.spyOn(f.ws.governance.store,'append').mockImplementationOnce(async command=>{await append(command);throw Error('lost response with private text')});
    const commandId=moduleGovernanceMainCommandId(f.entry.id,{kind:'main_agent',rootSessionId:f.task.taskId,agentInstanceId:f.binding.agentInstanceId,agentSessionId:f.binding.agentSessionId,runId:f.runId,toolCallId:'lost',toolName:'cbim_governance_observe'});
    await expect(f.call('cbim_governance_observe',f.observe,'lost')).rejects.toMatchObject({code:'GOVERNANCE_UNKNOWN',message:expect.stringContaining(commandId)});spy.mockRestore();
    const receipt=governanceReceiptOutputSchema.parse(await f.port.receipt({commandId},signal()));expect(receipt.status).toBe('recorded');const bytes=await fs.readFile(f.ledger);
    await f.app.open(f.entry.id,true);await expect(f.port.get({moduleId:data.moduleId},signal())).rejects.toMatchObject({code:'NOT_RUNNING'});
    const ws=f.app.workspace(f.entry.id),binding=await f.app.memberDispatch(f.entry.id).conversationBinding(f.task),reopened=mainGovernanceTools(ws,f.task,randomUUID(),binding);
    expect(await reopened.receipt({action:'observe',toolCallId:'lost',runId:f.runId},signal())).toEqual(receipt);expect(await fs.readFile(f.ledger)).toEqual(bytes);
    expect((await ws.snapshot()).revision).toBe(f.snapshot.revision);
  }finally{vi.restoreAllMocks();await f.cleanup()}
});

it('真实超长正文返回 oversized 且 recorded=false，不追加观察或截断为替换正文',async()=>{
  const f=await setup(true);try{
    const bytes=await fs.readFile(f.ledger),output=await f.call('cbim_governance_observe',f.observe,'oversized');expect(output).toMatchObject({status:'oversized',recorded:false,body:{state:'oversized',reason:'body_limit'}});expect(output.body.text).toBeUndefined();expect(await fs.readFile(f.ledger)).toEqual(bytes);
    expect(await f.port.receipt({commandId:output.commandId},signal())).toMatchObject({status:'unknown'});
  }finally{await f.cleanup()}
});

it('端口业务输出错误不再调用领域；单次JSON快照只序列化一次并绑定原来源',async()=>{
  const f=await setup();try{
    const actual=await f.port.get({moduleId:data.moduleId},signal()),toJSON=vi.fn(()=>actual),get=vi.fn(async()=>({toJSON}) as any),port:GovernanceToolsPort={...f.port,get},tools=new GovernanceTools(port,{...f.binding,runId:f.runId});
    const result=await tools.call('cbim_governance_get',{moduleId:data.moduleId},signal());expect(JSON.parse(result.content[0].text)).toEqual(actual);expect(toJSON).toHaveBeenCalledTimes(1);expect(get).toHaveBeenCalledTimes(1);
    get.mockResolvedValueOnce({...actual,identity:{...actual.identity,rootSessionId:'wrong-root'}} as any);await expect(tools.call('cbim_governance_get',{moduleId:data.moduleId},signal())).rejects.toMatchObject({code:'TOOL_OUTPUT_INVALID'});expect(get).toHaveBeenCalledTimes(2);
    const note={text:'文'.repeat(512),totalCharacters:512,truncated:false},origin={kind:'main_agent' as const,rootSessionId:f.task.taskId,agentInstanceId:f.binding.agentInstanceId,agentSessionId:f.binding.agentSessionId,runId:f.runId,toolCallId:'文'.repeat(512),toolName:'cbim_governance_observe' as const},overview={path:'.cbim/workspace/'+('long_path/'.repeat(180))+'module.md',hash:'a'.repeat(64)};
    const large=governanceGetOutputSchema.parse({...actual,observations:{total:20,truncated:false,items:Array.from({length:20},()=>({observationId:randomUUID(),protectionId:f.observe.protectionId,protectionRevision:1,knowledgeRevision:f.snapshot.revision,overview,statement:note,observedAt:new Date().toISOString(),origin}))},proposals:{total:20,truncated:false,items:Array.from({length:20},()=>({proposalId:randomUUID(),protectionId:f.observe.protectionId,observationId:randomUUID(),basis:'a'.repeat(64),reason:note,createdAt:new Date().toISOString(),decisionRevision:0,origin:{...origin,toolName:'cbim_governance_propose'}}))}});
    expect(Buffer.byteLength(JSON.stringify(large))).toBeGreaterThan(128*1024);get.mockResolvedValueOnce(large as any);await expect(tools.call('cbim_governance_get',{moduleId:data.moduleId},signal())).rejects.toMatchObject({code:'TOOL_OUTPUT_INVALID'});expect(get).toHaveBeenCalledTimes(3);
  }finally{await f.cleanup()}
});
