import {expect,test,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fixture} from '../../../application/unittest/support/helpers';
import {request} from '../../../knowledge/rules/unittest/data/knowledge';
import {seedTeam} from '../../../knowledge/service/unittest/support/team-fixture';
import {registerServiceOwner} from '../../../team/service/unittest/support/owner-service-fixture';
import {RunJournal} from '../../../execution/storage/run-journal';
import {mainToolCommandId} from '../../../tools/runtime/main-tool-contracts';
import {toolReceipt} from '../../../tools/rules/receipts';
import {jsonToolResult} from '../../../tools/rules/results';
import type {GoalPlanInput} from '../../../tasks/rules/scope-goal';
import type {TaskSpec} from '../../../tasks/rules/types';
import type {VerifiableMainToolName,CommandVerificationReport} from '../../../tasks/rules/command-verification';
import {reportFixture,reportInputs,reportIdentity,reportBinding,evidenceFor} from './support/command-verification-fixture';
import {restoreMainCommand} from '../../../tasks/runtime/main-command-request';

test('实际Application三种已提交命令经原canonical只读查询；cancel无伪goal版本，unknown不清除且重开不重放',async()=>{
  const f=await fixture();try{
    const entry=await f.app.Dispatch('add',{path:f.a}),workspace=f.app.Workspace(entry.id),service=f.app.MemberDispatch(entry.id),team=await seedTeam(workspace),snapshot=await workspace.Snapshot(),modulePath=team.input.moduleId+'/module.json',definition=JSON.parse(snapshot.files.find(file=>file.path===modulePath)!.text);
    definition.maintenance={bindingId:'report-maintenance',maintainerPersonIds:['owner'],revision:1,state:'active',confirmation:{recordId:'report-confirm',source:'local_user',confirmedAt:'2026-11-08T00:00:00.000Z'}};
    await workspace.Commit(request(snapshot,[{path:modulePath,text:JSON.stringify(definition)},{path:'.cbim/team/people.json',text:JSON.stringify({people:[{id:'owner',name:'维护人',team:'.cbim/team'}]})}]));
    await registerServiceOwner(f.app,workspace,'.cbim/team/dev',[team.input.moduleId]);const selection=(await service.owners.Discover([team.input.moduleId])).groups[0].selection!;
    const identity={workspaceId:entry.id,rootSessionId:'command-report-root'},binding={...identity,scopeId:'command-report-scope',runId:'command-report-run'};
    const task:TaskSpec={workspaceId:entry.id,taskId:identity.rootSessionId,mode:'chat',root:workspace.entry.path,agentId:'cbim:main',moduleIds:[],goal:'原用户输入',acceptance:[]},conversationBinding=await service.ConversationBinding(task);
    await service.OpenScope(identity,binding.scopeId,{message:'原用户输入'},binding.runId);
    const directory=path.join(workspace.paths.Project(entry.id),'loop-engine','tasks',task.taskId,binding.runId),journal=new RunJournal(directory,task,binding.runId);await journal.Init();await journal.Append({type:'run.started',data:{task,conversationBinding}});
    const stored=workspace.dispatchStore,originals:Array<{name:VerifiableMainToolName;callId:string;commandId:string}>=[];
    async function write<T>(name:VerifiableMainToolName,input:Record<string,unknown>,callId:string,execute:(commandId:string)=>Promise<T>,unfinished=false){
      const commandId=mainToolCommandId(name,binding,callId)!,call={id:callId,name,input},decision={allow:true as const,effects:['maintenance' as const],scope:{kind:'workspace' as const,workspaceId:entry.id}};
      await journal.Append({type:'tool.proposed',data:call});await journal.Append({type:'tool.allowed',data:{...call,effects:decision.effects,scope:decision.scope}});
      const result=await execute(commandId);if(!unfinished){const output=jsonToolResult(name,{error:'TOOL_OUTPUT_INVALID'}),receipt=toolReceipt({workspaceId:entry.id,taskId:task.taskId,runId:binding.runId},call,decision,'failed',output);await journal.Append({type:'tool.finished',data:{...call,isError:true,result:output,receipt}})}
      originals.push({name,callId,commandId});return result;
    }
    const plan:GoalPlanInput={expectedRevision:1,objective:'明确任务',constraints:[],criteria:[{id:'c',text:'真实读取',kind:'evidence'}],assignments:[{agentId:'.cbim/team/dev',moduleIds:[team.input.moduleId],ownerSelection:selection,criterionIds:['c'],reason:'负责岗位'}],reason:'原规划'};
    await write('cbim_goal_plan',plan,'plan-call',command=>service.goals.Plan(identity,binding.scopeId,binding.runId,command,plan));
    const modelTask={agentId:'.cbim/team/dev',moduleIds:[team.input.moduleId],ownerSelection:selection,goal:'实际工作',acceptance:[{id:'c',text:'真实读取'}]},graph=await service.Snapshot(identity);
    const dispatched=await write('cbim_dispatch_task',modelTask,'dispatch-call',command=>{const {agentId,...body}=modelTask;return service.DispatchTask({...identity,commandId:command,expectedParentRevision:graph.root.revision,task:{...body,assigneeAgentId:agentId}},binding.scopeId)});
    const next=await service.Snapshot(identity),target=next.tasks.find(item=>item.taskId===dispatched.taskId)!,cancel={expectedGraphCursor:{streamId:next.cursor.streamId,seq:next.cursor.seq},targets:[{taskId:target.taskId,expectedRevision:target.revision}],reason:'明确取消未执行任务'};
    await write('cbim_dispatch_cancel',cancel,'cancel-call',command=>service.CancelQueued(identity,binding.scopeId,binding.runId,command,cancel),true);
    const canonicalFile=path.join(directory,'events.jsonl'),storeFile=path.join(stored.directory,'dispatch.jsonl'),before={canonical:await fs.readFile(canonicalFile),store:await fs.readFile(storeFile)};
    const transact=vi.spyOn(stored,'Transact'),reports:CommandVerificationReport[]=[];
    for(const original of originals){const report=await f.app.Dispatch('dispatch.commandReport',{...identity,runId:binding.runId,toolCallId:original.callId}) as CommandVerificationReport;expect(report.command).toMatchObject({state:'committed',commandId:original.commandId,result:{toolName:original.name}});reports.push(report)}
    expect(reports[2].source.outcome).toBe('unknown');expect(reports[0].source.outcome).toBe('failed');expect(transact).not.toHaveBeenCalled();transact.mockRestore();
    expect((await RunJournal.Read(directory)).unresolvedTools).toEqual(['cancel-call']);expect(await fs.readFile(canonicalFile)).toEqual(before.canonical);expect(await fs.readFile(storeFile)).toEqual(before.store);
    expect((await service.Snapshot(identity)).tasks[0]).toMatchObject({status:'cancelled',runIds:[]});
    await f.app.Stop(entry.id);await expect(f.app.Dispatch('dispatch.commandReport',{...identity,runId:binding.runId,toolCallId:'cancel-call'})).rejects.toBeTruthy();expect(await fs.readFile(storeFile)).toEqual(before.store);
    // 本测试没有启动真正 Runtime，重开可按既有规则封存孤立活动scope；查询本身仍零写入，原命令不可重做。
    await f.app.Open(entry.id);const openedBytes=await fs.readFile(storeFile);const reopened=await f.app.Dispatch('dispatch.commandReport',{...identity,runId:binding.runId,toolCallId:'cancel-call'}) as CommandVerificationReport;expect(reopened.command).toEqual(reports[2].command);expect(await fs.readFile(storeFile)).toEqual(openedBytes);expect(await fs.readFile(canonicalFile)).toEqual(before.canonical);expect((await f.app.Workspace(entry.id).dispatchStore.Read()).runs).toHaveLength(0);
  }finally{await f.cleanup()}
});

test('未打开的已登记工作区IPC不初始化Store或运行服务',async()=>{
  const f=await fixture();try{const entry=await f.app.catalog.Add(f.a),file=path.join(f.user,entry.id,'dispatch','dispatch.jsonl');const opening=vi.spyOn(f.app,'Open');await expect(f.app.Dispatch('dispatch.commandReport',{workspaceId:entry.id,rootSessionId:'root',runId:'run',toolCallId:'call'})).rejects.toBeTruthy();expect(opening).not.toHaveBeenCalled();expect(f.app.running.has(entry.id)).toBe(false);await expect(fs.stat(file)).rejects.toMatchObject({code:'ENOENT'});opening.mockRestore()}finally{await f.cleanup()}
});

test('独立邮箱与conversation可核实；同名角色跨instance/跨root通道拒绝',async()=>{
  const one=reportInputs()[0],r=restoreMainCommand(one.name,reportBinding,reportIdentity.toolCallId,one.input),e=evidenceFor(one.name,r.input,r.commandId,r.fingerprint!);
  expect((await reportFixture(one.name,one.input,e).service.Read(reportIdentity)).command.state).toBe('committed');
  for(const field of ['agentInstanceId','rootSessionId','teamId','workspaceId'] as const){const f=reportFixture(one.name,one.input,e);f.state.sessions[0][field]='foreign';expect((await f.service.Read(reportIdentity)).source.state).toBe('invalid');expect(f.commandEvidence).not.toHaveBeenCalled()}
  const f=reportFixture(one.name,one.input,e);f.state.sessions[1].purpose='conversation';expect((await f.service.Read(reportIdentity)).source.state).toBe('invalid');
});

test('合法512字符原call完整查询不截断，未知状态仍保留',async()=>{
  const one=reportInputs()[0],callId='c'.repeat(512),input={...reportIdentity,toolCallId:callId},r=restoreMainCommand(one.name,reportBinding,callId,one.input),e=evidenceFor(one.name,r.input,r.commandId,r.fingerprint!),f=reportFixture(one.name,one.input,e);
  for(const event of f.summary.events)if(event.data.id){event.data.id=callId;const receipt=event.data.receipt as {toolCallId:string}|undefined;if(receipt)receipt.toolCallId=callId}
  for(const receipt of f.summary.toolReceipts??[])receipt.toolCallId=callId;
  expect(await f.service.Read(input)).toMatchObject({identity:input,source:{state:'verified'},command:{state:'committed',commandId:r.commandId}});
});
