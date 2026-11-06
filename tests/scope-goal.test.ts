import {it,expect} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fixture,request} from './helpers';
import {seedTeam} from './team-fixture';
import {json,hash} from '../src/backend/core/foundation/serialization';
import {toolReceipt} from '../src/backend/core/tools/receipts';
import {jsonToolResult} from '../src/backend/core/tools/results';
import type {ToolCall,ToolDecision} from '../src/backend/core/tools/types';
import type {TaskSpec,RunSummary,AgentEngine,EngineContext} from '../src/backend/core/brain/types';
import type {GoalPlanInput,GoalReviewInput} from '../src/backend/core/tasks/scope-goal';
import {FileDispatchStore} from '../src/backend/main/persistence/tasks/dispatch-store';
import {RunJournal} from '../src/backend/main/persistence/tasks/run-journal';
import {FileRunStorage} from '../src/backend/main/persistence/tasks/run-storage';
import {LoopRuntime} from '../src/backend/core/brain/runtime';
import {MemberExecutionManager} from '../src/backend/scheduler-engine/execution/member-execution';
import {WorkspaceDispatchService} from '../src/backend/scheduler-engine/execution/dispatch-service';

const plan=(expectedRevision=1):GoalPlanInput=>({expectedRevision,objective:'维护团队知识',constraints:['不得写业务工程'],criteria:[{id:'c1',text:'知识提交可以追溯',kind:'evidence'}],assignments:[{agentId:'cbim:main',moduleIds:[],criterionIds:['c1'],reason:'主角色负责治理'}],reason:'保存治理目标'});
const review=(expectedRevision=2):GoalReviewInput=>({expectedRevision,decision:'complete',checks:[{criterionId:'c1',outcome:'satisfied',reason:'当前版本已提交',evidence:[{kind:'main-knowledge',toolCallIds:['commit-one']}]}],superseded:[],gaps:[],reason:'目标已核实'});

async function setup(){
  const f=await fixture(),entry=await f.app.dispatch('add',{path:f.a}),workspace=f.app.workspace(entry.id);
  const directory=path.join(f.user,'goals'),store=new FileDispatchStore(directory,entry.id),rootSessionId='goal-root',runId='goal-run';
  let summary:RunSummary;
  const memberDirectory=path.join(f.user,'member-log');
  const service=new WorkspaceDispatchService(workspace,store,{inspectMember:run=>RunJournal.read(path.join(memberDirectory,run.binding.taskId,run.binding.runId)),inspectMain:async(root,run)=>{expect(root).toBe(rootSessionId);expect(run).toBe(runId);return structuredClone(summary??await RunJournal.read(journal.directory))}});
  const identity={workspaceId:entry.id,rootSessionId},task:TaskSpec={mode:'chat',taskId:rootSessionId,workspaceId:entry.id,root:f.a,goal:'旧会话标题',moduleIds:[],agentId:'cbim:main',acceptance:[]};
  const binding=await service.conversationBinding(task);
  const scope=await service.openScope(identity,'goal-scope',{message:'  本轮维护知识\n',attachmentIds:[]});
  const journal=new RunJournal(path.join(f.user,'goal-log'),task,runId);await journal.init();await journal.append({type:'run.started',data:{task,message:scope.goal!.input.message,conversationBinding:binding}});
  const emitTool=async(call:ToolCall,decision:ToolDecision,result:unknown)=>{
    await journal.append({type:'tool.allowed',data:{...call,...decision}});
    const receipt=toolReceipt({workspaceId:entry.id,taskId:rootSessionId,runId},call,decision,'succeeded',result);
    await journal.append({type:'tool.finished',data:{id:call.id,name:call.name,result,isError:false,receipt}});return receipt;
  };
  const commit=async()=>{
    const snapshot=await workspace.snapshot(),previous=snapshot.files.find(file=>file.path==='.cbim/README.md')?.text??'# 知识';
    const args=request(snapshot,[{path:'.cbim/README.md',text:previous+'\n已审阅的知识调整。'}]);
    const result=await workspace.commit(args);
    await emitTool({id:'commit-one',name:'cbim_knowledge_commit',input:args},{allow:true,effects:['knowledge-write'],scope:{kind:'knowledge',workspaceId:entry.id}},jsonToolResult('cbim_knowledge_commit',result));return result;
  };
  return {...f,entry,workspace,directory,memberDirectory,store,service,identity,scope,journal,task,runId,emitTool,commit,setSummary:(value:RunSummary)=>{summary=value},cleanup:async()=>{await store.close();await f.cleanup()}};
}

it('计划核实真实身份并逐版持久化，幂等命令不重做；输入、旧记录与重放保持原样',async()=>{
  const f=await setup();try{
    const first=await f.service.goals.plan(f.identity,f.scope.scopeId,f.runId,'plan-one',plan());
    expect(first.goal).toMatchObject({revision:2,input:f.scope.goal!.input,plan:{revision:2,runId:f.runId,assignments:[{agentName:'CBIM 主 Agent',teamId:'.cbim/team',moduleNames:[]}]}});
    expect(await f.service.goals.plan(f.identity,f.scope.scopeId,f.runId,'plan-one',plan())).toEqual(first);
    await expect(f.service.goals.plan(f.identity,f.scope.scopeId,f.runId,'plan-one',{...plan(),objective:'偷偷改写'})).rejects.toMatchObject({code:'COMMAND_ID_CONFLICT'});
    await expect(f.service.goals.plan(f.identity,f.scope.scopeId,f.runId,'plan-stale',plan())).rejects.toMatchObject({code:'GOAL_REVISION_CONFLICT'});
    expect((await f.service.openScope(f.identity,f.scope.scopeId,{message:f.scope.goal!.input.message})).goal).toEqual(first.goal);
    const reader=new FileDispatchStore(f.directory,f.entry.id);try{expect(await reader.read()).toEqual(await f.store.read())}finally{await reader.close()}
    await f.service.closeScope(f.identity,f.scope.scopeId,'cancelled');
    const legacy=await f.service.openScope(f.identity,'legacy');
    await expect(f.service.goals.plan(f.identity,'legacy',f.runId,'legacy-plan',plan())).rejects.toMatchObject({code:'GOAL_LEGACY'});
    expect(legacy.goal).toBeUndefined();
  }finally{await f.cleanup()}
});

it('计划校验真实执行角色和模块，派发必须匹配计划及当前知识版本',async()=>{
  const f=await setup();try{
    const team=await seedTeam(f.workspace),snapshot=await f.workspace.snapshot(),modulePath=team.input.moduleId+'/module.json',definition=JSON.parse(snapshot.files.find(file=>file.path===modulePath)!.text);
    definition.maintenance={bindingId:'maintain',maintainerPersonIds:['owner'],revision:1,state:'active',confirmation:{recordId:'review',source:'local_user',confirmedAt:'2026-11-06T00:00:00.000Z'}};
    await f.workspace.commit(request(snapshot,[{path:'.cbim/team/people.json',text:json({people:[{id:'owner',name:'维护人',team:'.cbim/team'}]})},{path:modulePath,text:json(definition)}]));
    const draft=plan(),input={...f.identity,commandId:'dispatch-good',expectedParentRevision:1,task:{assigneeAgentId:'cbim:executor',moduleIds:[team.input.moduleId],goal:'验证模块',acceptance:[{id:'c1',text:'真实证据'}],prerequisites:[]}};
    await expect(f.service.dispatchTask(input,f.scope.scopeId)).rejects.toMatchObject({code:'GOAL_PLAN_REQUIRED'});
    await expect(f.service.goals.plan(f.identity,f.scope.scopeId,f.runId,'missing-agent',{...draft,assignments:[{...draft.assignments[0],agentId:'unknown',moduleIds:[team.input.moduleId]}]})).rejects.toMatchObject({code:'AGENT_MISSING'});
    draft.assignments=[{...draft.assignments[0],agentId:'cbim:executor',moduleIds:[team.input.moduleId]}];
    const planned=await f.service.goals.plan(f.identity,f.scope.scopeId,f.runId,'plan-executor',draft);
    await expect(f.service.dispatchTask({...input,commandId:'wrong-agent',task:{...input.task,assigneeAgentId:team.input.agentId}},f.scope.scopeId)).rejects.toMatchObject({code:'GOAL_ASSIGNMENT_MISMATCH'});
    await f.service.dispatchTask(input,f.scope.scopeId);
    expect((await f.service.goals.inspect(f.identity,f.scope.scopeId)).goal!.revision).toBe(2);
    await f.commit();
    await expect(f.service.dispatchTask({...input,commandId:'stale-knowledge'},f.scope.scopeId)).rejects.toMatchObject({code:'GOAL_KNOWLEDGE_CHANGED'});
    expect(planned.goal!.plan!.assignments[0].moduleNames).toHaveLength(1);
  }finally{await f.cleanup()}
});

it('真实知识提交可成为主治理证据，review只登记请求，settled后才允许completed关闭',async()=>{
  const f=await setup();try{
    await f.service.goals.plan(f.identity,f.scope.scopeId,f.runId,'plan-one',plan());await f.commit();
    // 审阅正在工具中运行，不要求此时 RunJournal 已 settled；但它不会关闭 scope。
    const reviewed=await f.service.goals.review(f.identity,f.scope.scopeId,f.runId,'review-one',review());
    expect(reviewed.status).toBe('active');expect(reviewed.goal).toMatchObject({revision:3,review:{decision:'complete',planRevision:2,runId:f.runId}});
    await expect(f.service.closeScope(f.identity,f.scope.scopeId,'completed',await RunJournal.read(f.journal.directory))).rejects.toMatchObject({code:'GOAL_MAIN_UNSETTLED'});
    await f.journal.append({type:'run.settled',data:{status:'completed'}});
    const closed=await f.service.closeScope(f.identity,f.scope.scopeId,'completed',await RunJournal.read(f.journal.directory));
    expect(closed.outcome).toBe('completed');expect(closed.goal).toEqual(reviewed.goal);
    const reader=new FileDispatchStore(f.directory,f.entry.id);try{expect((await reader.read()).scopes![0]).toEqual(closed)}finally{await reader.close()}
  }finally{await f.cleanup()}
});

it('人工验收不能由模型代签或replan删除/降级，完整校验和的重放也拒绝',async()=>{
  const f=await setup();try{
    const draft=plan();draft.criteria[0].kind='human';const planned=await f.service.goals.plan(f.identity,f.scope.scopeId,f.runId,'human-plan',draft);
    await expect(f.service.goals.review(f.identity,f.scope.scopeId,f.runId,'fake-human',review())).rejects.toMatchObject({code:'GOAL_HUMAN_REQUIRED'});
    await expect(f.service.goals.plan(f.identity,f.scope.scopeId,f.runId,'remove-human',plan(2))).rejects.toMatchObject({code:'GOAL_HUMAN_REQUIRED'});
    const changed=structuredClone(planned);changed.goal!.revision=3;changed.goal!.plan!.revision=3;changed.goal!.plan!.criteria[0].kind='evidence';
    await expect(f.store.transact({commandId:'bypass-human',fingerprint:'bypass-human'},async()=>({scopes:[changed],receipt:true}))).rejects.toMatchObject({code:'GRAPH_INPUT_INVALID'});
    const file=path.join(f.directory,'dispatch.jsonl'),original=await fs.readFile(file,'utf8'),previous=JSON.parse(original.trim().split('\n').at(-1)!);
    const body={version:1,workspaceId:f.entry.id,transactionSeq:previous.body.transactionSeq+1,previousHash:previous.checksum,command:{commandId:'forged-history',fingerprint:'forged-history'},mutation:{scopes:[changed],receipt:true}};
    await fs.writeFile(file,original+JSON.stringify({body,checksum:hash(JSON.stringify(body))})+'\n');
    const reader=new FileDispatchStore(f.directory,f.entry.id);try{await expect(reader.read()).rejects.toMatchObject({code:'GRAPH_LOG_CORRUPT'})}finally{await reader.close();await fs.writeFile(file,original)}
  }finally{await f.cleanup()}
});

it('主治理日志可读前缀后的截断尾行不能据以申请完成审阅',async()=>{
  const f=await setup();try{
    await f.service.goals.plan(f.identity,f.scope.scopeId,f.runId,'plan-one',plan());await f.commit();
    await fs.appendFile(path.join(f.journal.directory,'events.jsonl'),'{"unfinished":');
    await expect(f.service.goals.review(f.identity,f.scope.scopeId,f.runId,'truncated-review',review())).rejects.toMatchObject({code:'GOAL_EVIDENCE_INVALID'});
    expect((await f.service.goals.inspect(f.identity,f.scope.scopeId)).goal!.review).toBeUndefined();
  }finally{await f.cleanup()}
});

it('不可伪造主知识receipt、跨运行/会话证据或仅凭工具名称宣称提交',async()=>{
  const f=await setup();try{
    await f.service.goals.plan(f.identity,f.scope.scopeId,f.runId,'plan-one',plan());await f.commit();
    const good=await RunJournal.read(f.journal.directory);
    const mutations=[(s:RunSummary)=>{s.conversationBinding!.agentSessionId='foreign'},(s:RunSummary)=>{s.runId='other-run'},(s:RunSummary)=>{s.toolReceipts![0].outcome='failed'},(s:RunSummary)=>{s.events.find(event=>event.type==='tool.finished')!.data.result={content:[{type:'text',text:'{"state":"committed"}'}]}}];
    for(let index=0;index<mutations.length;index++){
      const bad=structuredClone(good);mutations[index](bad);f.setSummary(bad);
      await expect(f.service.goals.review(f.identity,f.scope.scopeId,f.runId,'bad-'+index,review())).rejects.toMatchObject({code:index<2?'GOAL_EVIDENCE_IDENTITY':'GOAL_EVIDENCE_INVALID'});
    }
    const fake=structuredClone(good),finish=fake.events.find(event=>event.type==='tool.finished')!;
    finish.data.result=jsonToolResult('cbim_knowledge_commit',{state:'committed',workspaceId:f.entry.id,instanceId:f.workspace.instanceId,revision:(await f.workspace.read()).revision,requestId:'fake',changed:[]});
    fake.toolReceipts![0].resultHash=hash(JSON.stringify(finish.data.result));finish.data.receipt=fake.toolReceipts![0];f.setSummary(fake);
    await expect(f.service.goals.review(f.identity,f.scope.scopeId,f.runId,'empty-change',review())).rejects.toMatchObject({code:'GOAL_EVIDENCE_INVALID'});
    expect((await f.service.goals.inspect(f.identity,f.scope.scopeId)).goal!.revision).toBe(2);
  }finally{await f.cleanup()}
});

it('完成申请之后的新副作用、未决工具、知识变化和图变化都使完成失效',async()=>{
  const f=await setup();try{
    await f.service.goals.plan(f.identity,f.scope.scopeId,f.runId,'plan-one',plan());await f.commit();
    const reviewed=await f.service.goals.review(f.identity,f.scope.scopeId,f.runId,'review-one',review());
    await f.journal.append({type:'run.settled',data:{status:'completed'}});const main=await RunJournal.read(f.journal.directory),state=await f.store.read();
    await f.service.goals.validateCompletion(state,reviewed,main);
    const pending=structuredClone(main);pending.unresolvedTools=['unknown'];await expect(f.service.goals.validateCompletion(state,reviewed,pending)).rejects.toMatchObject({code:'GOAL_MAIN_UNSETTLED'});
    const truncated=structuredClone(main);truncated.logIntegrity={partialTail:true};await expect(f.service.goals.validateCompletion(state,reviewed,truncated)).rejects.toMatchObject({code:'GOAL_MAIN_UNSETTLED'});
    const changed=structuredClone(state);changed.graphs[0].cursor.seq++;await expect(f.service.goals.validateCompletion(changed,reviewed,main)).rejects.toMatchObject({code:'GOAL_GRAPH_CHANGED'});
    const effect=structuredClone(main);effect.events.push({...effect.events.at(-1)!,seq:effect.events.length+1,type:'tool.allowed',data:{id:'late',name:'bash',effects:['command']}});await expect(f.service.goals.validateCompletion(state,reviewed,effect)).rejects.toMatchObject({code:'GOAL_EFFECT_CHANGED'});
    const snapshot=await f.workspace.snapshot();await f.workspace.commit(request(snapshot,[{path:'.cbim/README.md',text:'# 外部改动'}]));
    await expect(f.service.goals.validateCompletion(state,reviewed,main)).rejects.toMatchObject({code:'GOAL_KNOWLEDGE_CHANGED'});
  }finally{await f.cleanup()}
});

it('没有可信日志端口无法review；反复规划达到上限后可记录阻塞并关闭，不能改写输入',async()=>{
  const f=await setup();try{
    const noLogs=new WorkspaceDispatchService(f.workspace,f.store);
    await noLogs.goals.plan(f.identity,f.scope.scopeId,f.runId,'plan-one',plan());
    await expect(noLogs.goals.review(f.identity,f.scope.scopeId,f.runId,'no-logs',review())).rejects.toMatchObject({code:'GOAL_EVIDENCE_UNAVAILABLE'});
    for(let revision=2;revision<=64;revision++)await f.service.goals.plan(f.identity,f.scope.scopeId,f.runId,'plan-'+revision,plan(revision));
    await expect(f.service.goals.plan(f.identity,f.scope.scopeId,f.runId,'too-many',plan(65))).rejects.toMatchObject({code:'GOAL_DECISION_LIMIT'});
    const blocked=await f.service.goals.block(f.identity,f.scope.scopeId,'决策达到上限，需要用户确认下一步');expect(blocked.goal!.revision).toBe(65);expect(blocked.goal!.input).toEqual(f.scope.goal!.input);
    await expect(f.service.goals.plan(f.identity,f.scope.scopeId,f.runId,'after-block',plan(65))).rejects.toMatchObject({code:'GOAL_BLOCKED'});
    const closed=await f.service.closeScope(f.identity,f.scope.scopeId,'failed');expect(closed.goal!.blocked).toEqual(blocked.goal!.blocked);
  }finally{await f.cleanup()}
});

it('superseded环在查询成员前拒绝；稠密无环关系可有限时间失败而不指数展开',async()=>{
  const f=await setup();try{
    await f.service.goals.plan(f.identity,f.scope.scopeId,f.runId,'plan-one',plan());
    const draft:GoalReviewInput={expectedRevision:2,decision:'replan',checks:[],superseded:[{taskId:'a',replacementTaskIds:['b'],reason:'替代'},{taskId:'b',replacementTaskIds:['a'],reason:'替代'}],gaps:['尚需验证'],reason:'重新规划'};
    await expect(f.service.goals.review(f.identity,f.scope.scopeId,f.runId,'cycle',draft)).rejects.toMatchObject({code:'GOAL_SUPERSESSION_CYCLE'});
    draft.superseded=Array.from({length:70},(_,index)=>({taskId:'task-'+index,replacementTaskIds:Array.from({length:70-index},(__,offset)=>'task-'+(index+offset+1)),reason:'替代'}));
    await expect(f.service.goals.review(f.identity,f.scope.scopeId,f.runId,'dense',draft)).rejects.toMatchObject({code:'GOAL_SUPERSESSION_INVALID'});
  }finally{await f.cleanup()}
});

it('真实成员失败必须由后续成功候选替代，知识变更后旧候选必须重新执行而非重盖版本',async()=>{
  const f=await setup();let members:MemberExecutionManager|undefined;
  try{
    const team=await seedTeam(f.workspace),snapshot=await f.workspace.snapshot(),moduleId=team.input.moduleId,definition=JSON.parse(snapshot.files.find(file=>file.path===moduleId+'/module.json')!.text);
    definition.maintenance={bindingId:'maintain',maintainerPersonIds:['owner'],revision:1,state:'active',confirmation:{recordId:'review',source:'local_user',confirmedAt:'2026-11-06T00:00:00.000Z'}};
    await f.workspace.commit(request(snapshot,[{path:'.cbim/team/people.json',text:json({people:[{id:'owner',name:'维护人',team:'.cbim/team'}]})},{path:moduleId+'/module.json',text:json(definition)}]));
    const draft=plan();draft.assignments=[{agentId:'cbim:executor',moduleIds:[moduleId],criterionIds:['c1'],reason:'真实执行验证'}];
    await f.service.goals.plan(f.identity,f.scope.scopeId,f.runId,'member-plan',draft);
    let failRun=true;
    const storage=new FileRunStorage(),model={id:'fixture',model:'fixture',name:'fixture',api:'openai-completions' as const,auth:'api-key' as const,baseUrl:'https://example.test/v1',contextWindow:200000,maxTokens:1000,reasoning:false};
    members=new MemberExecutionManager(f.workspace,f.store,{
      acquire:()=>()=>{},inspect:run=>storage.read(path.join(f.memberDirectory,run.binding.taskId,run.binding.runId)),
      prepare:async()=>({model,create:async(_run,_task,hooks)=>{
        let context:EngineContext;
        const engine:AgentEngine={kind:'goal-fixture',start:async value=>{context=value;await context.emit({type:'session.bound',data:{sessionId:context.nativeSessionId,sessionFile:path.join(f.memberDirectory,'native-'+context.nativeSessionId+'.jsonl')}})},stop:async()=>{},close:async()=>{},run:async()=>{
          if(failRun)return {status:'failed',error:'真实测试失败'};
          let sequence=0;
          const invoke=async(name:string,input:Record<string,unknown>)=>{
            const id='tool-'+(++sequence),decision=await context.beforeTool({id,name,input});expect(decision.allow).toBe(true);
            const result=name==='read'?jsonToolResult('read',{verified:true}):await context.taskTools!.call(name,input);
            await context.emit({type:'tool.finished',data:{id,name,result,isError:false}});return id;
          };
          await invoke('cbim_task_plan',{expectedVersion:0,goal:context.task.goal,acceptance:context.task.acceptance,reason:'核验真实目标',steps:[{id:'verify',title:'验证',owner:'当前成员'}]});
          const evidence=await invoke('read',{path:'src/app.ts'});
          await invoke('cbim_task_step',{expectedVersion:1,id:'verify',state:'reported_done',evidenceIds:[evidence]});
          await invoke('cbim_delivery_prepare',{expectedVersion:2,summary:'已验证结果',limitations:[]});return {status:'completed'};
        }};
        return new LoopRuntime({storage,directory:f.memberDirectory,createEngine:()=>engine,acquireLease:async()=>()=>{},onEngineReady:hooks.onEngineReady,onEvent:hooks.onEvent,toolPolicy:async call=>({allow:true,effects:[call.name==='read'?'read':'maintenance'],scope:{kind:'workspace',workspaceId:f.entry.id}})});
      }}),
    });await members.initialize();
    const execute=async(commandId:string)=>{
      const receipt=await f.service.dispatchTask({...f.identity,commandId,expectedParentRevision:1,task:{assigneeAgentId:'cbim:executor',moduleIds:[moduleId],goal:'验证业务实现',acceptance:[{id:'c1',text:'提供真实证据'}],prerequisites:[]}},f.scope.scopeId);
      await members!.start({...f.identity,taskId:receipt.taskId,commandId:'start-'+commandId,expectedRevision:1,options:{permission:'read'}});
      await members!.waitForSettlement({...f.identity,taskId:receipt.taskId});return (await f.service.snapshot(f.identity)).tasks.find(task=>task.taskId===receipt.taskId)!;
    };
    const failed=await execute('member-failed');expect(failed.status).toBe('failed');failRun=false;
    const passed=await execute('member-passed');expect(passed.status).toBe('result_ready');
    const candidate=(task:typeof passed,expectedRevision:number):GoalReviewInput=>({expectedRevision,decision:'complete',checks:[{criterionId:'c1',outcome:'satisfied',reason:'成员真实核验',evidence:[{kind:'member-result',taskId:task.taskId,runId:task.result!.runId,resultId:task.result!.resultId,planRevision:task.result!.planRevision,toolCallIds:task.result!.evidenceRefs}]}],superseded:[],gaps:[],reason:'汇总真实结果'});
    await expect(f.service.goals.review(f.identity,f.scope.scopeId,f.runId,'unreplaced',candidate(passed,2))).rejects.toMatchObject({code:'GOAL_WORK_FAILED'});
    const complete=candidate(passed,2);complete.superseded=[{taskId:failed.taskId,replacementTaskIds:[passed.taskId],reason:'成功重做原模块任务'}];
    await f.service.goals.review(f.identity,f.scope.scopeId,f.runId,'replaced',complete);
    // 新知识基线不能靠 replan 把旧成果自动变成当前证据，必须真实重做。
    await f.commit();await f.service.goals.plan(f.identity,f.scope.scopeId,f.runId,'new-baseline',{...draft,expectedRevision:3});
    await expect(f.service.goals.review(f.identity,f.scope.scopeId,f.runId,'old-evidence',{...complete,expectedRevision:4})).rejects.toMatchObject({code:'GOAL_EVIDENCE_STALE'});
    const latest=await execute('member-current'),final=candidate(latest,4);final.superseded=[failed,passed].map(task=>({taskId:task.taskId,replacementTaskIds:[latest.taskId],reason:'当前知识基线重新验证'}));
    const reviewed=await f.service.goals.review(f.identity,f.scope.scopeId,f.runId,'current-evidence',final);
    await f.journal.append({type:'run.settled',data:{status:'completed'}});
    expect((await f.service.closeScope(f.identity,f.scope.scopeId,'completed',await RunJournal.read(f.journal.directory))).goal).toEqual(reviewed.goal);
  }finally{await members?.close();await f.cleanup()}
});
