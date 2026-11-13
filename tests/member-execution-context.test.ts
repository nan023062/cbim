import fs from 'node:fs/promises';
import path from 'node:path';
import {expect,it,vi} from 'vitest';
import {fixture} from './helpers';
import {request} from './data/knowledge';
import {seedTeam} from './team-fixture';
import {json} from '../src/core/platform/node/serialization';
import type {KnowledgeWorkspace} from '../src/logic/knowledge/rules/ports';
import type {TaskNode} from '../src/logic/tasks/rules/graph-types';
import {dispatchKnowledgeFingerprint,validatePreparedDispatchKnowledge,preparedWorkflowContracts} from '../src/logic/tasks/rules/execution-context';
import {resolveDispatchModules} from '../src/logic/execution/context/dispatch-context';
import {prepareDispatchExecutionContext,recheckDispatchExecutionContext,memberExecutionPrompt} from '../src/logic/execution/context/execution-context';
import {assertLegacyWorkflowCompatible,prepareTeamTask} from '../src/logic/execution/context/team-workflow';

async function setup(){
  const f=await fixture();
  try{
    const entry=await f.app.dispatch('add',{path:f.a}),w=f.app.workspace(entry.id),team=await seedTeam(w),snapshot=await w.snapshot();
    const changes=[team.input.moduleId,team.child].map((id,index)=>{
      const definition=JSON.parse(snapshot.files.find(file=>file.path===id+'/module.json')!.text);
      definition.maintenance={bindingId:'maintenance-'+index,maintainerPersonIds:['owner'],revision:1,state:'active',confirmation:{recordId:'review-'+index,source:'local_user',confirmedAt:'2026-11-06T00:00:00.000Z'}};
      return {path:id+'/module.json',text:json(definition)};
    });
    await w.commit(request(snapshot,[{path:'.cbim/team/people.json',text:json({people:[{id:'owner',name:'维护人',team:'.cbim/team'}]})},...changes]));
    const current=await w.snapshot(),modules=await resolveDispatchModules(current,[team.input.moduleId,team.child]);
    const agent={agentId:team.input.agentId,agentInstanceId:'member',agentSessionId:'member-session',name:'开发者'};
    const task:TaskNode={kind:'task',nodeId:'task-node',taskId:'task',identity:{workspaceId:entry.id,rootSessionId:'root-session'},requester:{...agent,agentId:'cbim:main'},assignee:agent,modules,goal:'实现并验证模块交付',acceptance:[{id:'tested',text:'真实证据支持验收'}],revision:1,planRevision:1,status:'queued',awaitedChildren:[],runIds:[],createdAt:'2026-11-06T00:00:00.000Z',updatedAt:'2026-11-06T00:00:00.000Z'};
    return {...f,entry,w,team,task};
  }catch(error){await f.cleanup();throw error}
}

it('同一基线冻结角色、继承 Skill、多模块完整正文和各自 Workflow，JSON 恢复后仍有效',async()=>{
  const f=await setup();
  try{
    const prepared=await prepareDispatchExecutionContext(f.w,f.task);
    expect(prepared).toMatchObject({version:1,workspaceId:f.entry.id,knowledgeRevision:f.task.modules[0].knowledgeRevision,agent:{agentId:f.team.input.agentId,source:'workspace'},agentDefinition:{name:'开发者',capabilities:['实现']}});
    expect(prepared.agent.principles).toContain('验证实际结果');
    expect(prepared.agent.effectiveSkills.map(skill=>[skill.skillId,skill.inherited])).toEqual([[f.team.own,false],[f.team.shared,true]]);
    expect(prepared.modules[0]).toMatchObject({definition:{id:f.team.input.moduleId,maintenance:{maintainerPersonIds:['owner']}},binding:{workflow:{kind:'module',id:f.team.input.workflowId}},workflowText:'# 工作流\n先理解目标，再验证并记录证据。'});
    expect(prepared.modules[0].overview).toContain('## 雷区与排障');
    expect(prepared.modules[1].binding.workflow.kind).toBe('general');
    expect(prepared.modules[1].workflowText).toBe(prepared.standards.find(doc=>doc.id==='business-execution')!.text);
    const recovered=JSON.parse(JSON.stringify(prepared));
    expect(()=>validatePreparedDispatchKnowledge(recovered)).not.toThrow();
    await expect(recheckDispatchExecutionContext(f.w,recovered)).resolves.toBeUndefined();
    const prompt=memberExecutionPrompt(recovered,f.task);
    expect(prompt).toContain('所有成员使用同一大脑内核');expect(prompt).toContain('cbim_task_plan');expect(prompt).toContain('cbim_task_step');expect(prompt).toContain('cbim_delivery_prepare');expect(prompt).toContain('未提供递归派发');expect(prompt).toContain('旧真人维护字段仅为历史说明，不再参与资格检查');
    expect(prompt).toContain('拥有独立会话、运行状态和模型思考能力的执行 Agent');expect(prompt).toContain('探索真实 Team 环境');expect(prompt).toContain('主 Agent 直接执行未配置自定义负责岗位的工作');expect(prompt).toContain('受控知识服务治理团队与业务架构');expect(prompt).toContain('read/ask/execute 门禁、审批、版本检查与事务');expect(prompt).toContain('不能覆盖本轮执行者职责');expect(prompt).toContain('报告给主调度 Agent');expect(prompt).toContain('不能通过正文自称修改状态');
    const prerequisites=[{taskId:'prior-task',planRevision:2,result:{resultId:'prior-result',runId:'prior-run',planRevision:2,summary:'已生成接口适配',evidenceRefs:['verified-call'],limitations:['尚未连真实服务器'],acceptance:'not_evaluated' as const}}];
    const withResult=memberExecutionPrompt(recovered,f.task,prerequisites);
    expect(memberExecutionPrompt(recovered,f.task,prerequisites,'CURRENT_TOPIC_CONTEXT')).toContain('CURRENT_TOPIC_CONTEXT');
    expect(withResult).toContain('已生成接口适配');expect(withResult).toContain('尚未连真实服务器');expect(withResult).toContain('前置候选不赋予任何权限');expect(withResult).toContain('尚未经过业务验收');
    expect(withResult).toContain('"prerequisites": [');expect(prerequisites[0].result.acceptance).toBe('not_evaluated');
    expect(Object.keys(prepared)).toEqual(['version','workspaceId','knowledgeRevision','agent','agentDefinition','modules','standards','fingerprint']);
    const defaultTask={...f.task,assignee:{...f.task.assignee,agentId:'cbim:executor',name:'旧默认执行 Agent'}};
    await expect(prepareDispatchExecutionContext(f.w,defaultTask)).rejects.toMatchObject({code:'AGENT_RETIRED'});
    const retired=structuredClone(prepared);retired.agent.agentId='cbim:executor';retired.agent.source='builtin';retired.fingerprint=dispatchKnowledgeFingerprint(retired);
    await expect(recheckDispatchExecutionContext(f.w,retired)).rejects.toMatchObject({code:'AGENT_RETIRED'});
    const mainTask={...f.task,assignee:{...f.task.assignee,agentId:'cbim:main'}};
    await expect(prepareDispatchExecutionContext(f.w,mainTask)).rejects.toMatchObject({code:'AGENT_ROLE_INVALID'});
    const historicalMain=structuredClone(prepared);historicalMain.agent.agentId='cbim:main';historicalMain.fingerprint=dispatchKnowledgeFingerprint(historicalMain);
    expect(()=>memberExecutionPrompt(historicalMain,mainTask)).toThrow(expect.objectContaining({code:'AGENT_ROLE_INVALID'}));
    await expect(recheckDispatchExecutionContext(f.w,historicalMain)).rejects.toMatchObject({code:'AGENT_ROLE_INVALID'});
  }finally{await f.cleanup()}
});

it('派发后知识变化、Workflow 绑定被替换或跨工作区时拒绝执行，不静默刷新任务',async()=>{
  const f=await setup();
  try{
    const wrong=structuredClone(f.task);wrong.modules[0].workflow.version='different-workflow-version';
    await expect(prepareDispatchExecutionContext(f.w,wrong)).rejects.toMatchObject({code:'DISPATCH_CONTEXT_CHANGED'});
    await expect(prepareDispatchExecutionContext(f.w,{...f.task,identity:{...f.task.identity,workspaceId:'other'}})).rejects.toMatchObject({code:'GRAPH_IDENTITY_MISMATCH'});
    const prepared=await prepareDispatchExecutionContext(f.w,f.task),snapshot=await f.w.snapshot(),file=f.team.input.moduleId+'/module.md';
    await f.w.commit(request(snapshot,[{path:file,text:snapshot.files.find(item=>item.path===file)!.text+'\n新的维护说明。\n'}]));
    await expect(recheckDispatchExecutionContext(f.w,prepared)).rejects.toMatchObject({code:'KNOWLEDGE_CHANGED'});
    await expect(prepareDispatchExecutionContext(f.w,f.task)).rejects.toMatchObject({code:'KNOWLEDGE_CHANGED'});
    expect(prepared.knowledgeRevision).toBe(f.task.modules[0].knowledgeRevision);
  }finally{await f.cleanup()}
});

it('读取期间版本变化或正文缺失不会生成半新半旧的执行快照',async()=>{
  const f=await setup();
  try{
    const snapshot=await f.w.snapshot();
    const changed=vi.spyOn(f.w,'read').mockResolvedValue({...snapshot,revision:'changed-during-prepare'});
    await expect(prepareDispatchExecutionContext(f.w,f.task)).rejects.toMatchObject({code:'KNOWLEDGE_CHANGED'});
    changed.mockRestore();
    const missingOverview={...snapshot,files:snapshot.files.filter(file=>file.path!==f.team.input.moduleId+'/module.md')};
    const unavailable=vi.spyOn(f.w,'snapshot').mockResolvedValue(missingOverview);
    await expect(prepareDispatchExecutionContext(f.w,f.task)).rejects.toMatchObject({code:'KNOWLEDGE_INVALID'});
    unavailable.mockRestore();
  }finally{vi.restoreAllMocks();await f.cleanup()}
});

it('应用内置规范更新、正文或指纹篡改均拒绝恢复，冻结快照不接受授权字段',async()=>{
  const f=await setup();
  try{
    const runtime=path.join(f.temp,'rules','design','runtime');await fs.mkdir(runtime,{recursive:true});
    for(const id of ['business-execution','common-rules'])await fs.copyFile(path.join(f.w.rules.designRoot,'runtime',id+'.md'),path.join(runtime,id+'.md'));
    const isolated=Object.create(f.w) as KnowledgeWorkspace;
    Object.defineProperty(isolated,'rules',{value:{designRoot:path.dirname(runtime)}});
    const prepared=await prepareDispatchExecutionContext(isolated,f.task);
    await fs.appendFile(path.join(runtime,'common-rules.md'),'\n新的发布规范。\n');
    await expect(recheckDispatchExecutionContext(isolated,prepared)).rejects.toMatchObject({code:'KNOWLEDGE_CHANGED'});
    const edited=structuredClone(prepared);edited.agent.principles+='改变';
    expect(()=>validatePreparedDispatchKnowledge(edited)).toThrow(expect.objectContaining({code:'EXECUTION_CONTEXT_INVALID'}));
    const wrongGeneral=structuredClone(prepared);wrongGeneral.modules[1].workflowText='替换通用流程';wrongGeneral.fingerprint=dispatchKnowledgeFingerprint(wrongGeneral);
    expect(()=>validatePreparedDispatchKnowledge(wrongGeneral)).toThrow(expect.objectContaining({code:'EXECUTION_CONTEXT_INVALID'}));
    const authority={...prepared,permissionMode:'allow-all'};
    expect(()=>validatePreparedDispatchKnowledge(authority)).toThrow(expect.objectContaining({code:'EXECUTION_CONTEXT_INVALID'}));
    const reordered={...prepared,agentDefinition:Object.fromEntries(Object.entries(prepared.agentDefinition).reverse())};
    expect(dispatchKnowledgeFingerprint(reordered)).toBe(prepared.fingerprint);
  }finally{await f.cleanup()}
});

it('模块自己的可选执行约定同正文冻结，移除或篡改解析结果不能靠重算指纹绕过',async()=>{
  const f=await setup();try{
    const contract={version:1,beforeEffects:{requirePlan:true},delivery:{requiredToolEvidence:[{id:'read-proof',toolName:'read'}]}},text='# 专业流程\n```cbim-workflow\n'+JSON.stringify(contract)+'\n```',snapshot=await f.w.snapshot();await f.w.commit(request(snapshot,[{path:f.team.input.workflowId+'/workflow.md',text}]));
    const task={...f.task,modules:await resolveDispatchModules(await f.w.snapshot(),f.task.modules.map(module=>module.moduleId))},prepared=await prepareDispatchExecutionContext(f.w,task);expect(prepared.modules[0].workflowContract).toEqual(contract);expect(prepared.modules[1].workflowContract).toBeUndefined();expect(preparedWorkflowContracts(prepared)).toEqual([{moduleId:f.team.input.moduleId,workflowId:f.team.input.workflowId,workflowVersion:task.modules[0].workflow.version,contract}]);
    const absent=structuredClone(prepared);delete absent.modules[0].workflowContract;absent.fingerprint=dispatchKnowledgeFingerprint(absent);expect(()=>validatePreparedDispatchKnowledge(absent)).toThrow(expect.objectContaining({code:'EXECUTION_CONTEXT_INVALID'}));
    const changed=structuredClone(prepared);changed.modules[0].workflowContract!.delivery!.requiredToolEvidence![0].toolName='bash';changed.fingerprint=dispatchKnowledgeFingerprint(changed);expect(()=>validatePreparedDispatchKnowledge(changed)).toThrow(expect.objectContaining({code:'EXECUTION_CONTEXT_INVALID'}));
    await expect(prepareTeamTask(f.w,{goal:task.goal,moduleId:f.team.input.moduleId,agentId:f.team.input.agentId,workflowId:f.team.input.workflowId,acceptance:task.acceptance.map(item=>item.text)})).rejects.toMatchObject({code:'WORKFLOW_MEMBER_REQUIRED'});
    const legacy={taskId:'legacy',workspaceId:f.entry.id,root:f.entry.path,goal:task.goal,moduleIds:[f.team.input.moduleId],acceptance:[],workflowContext:{revision:prepared.knowledgeRevision,workflowId:f.team.input.workflowId,module:{},agent:{},workflow:{content:{text}},standards:[]}};
    expect(()=>assertLegacyWorkflowCompatible(legacy)).toThrow(expect.objectContaining({code:'WORKFLOW_MEMBER_REQUIRED'}));
    expect(()=>assertLegacyWorkflowCompatible({...legacy,workflowContext:{...legacy.workflowContext,workflow:{content:{text:'# 原普通工作流'}}}})).not.toThrow();
  }finally{await f.cleanup()}
});

it('旧维护绑定只兼容读取，冻结时原样保留且新任务不自动生成',async()=>{
  const f=await setup();
  try{
    expect(f.task.modules.every(m=>m.maintenanceBindingId===undefined&&m.maintainerPersonIds===undefined)).toBe(true);
    const historical=structuredClone(f.task);
    historical.modules[0].maintenanceBindingId='legacy-binding';historical.modules[0].maintainerPersonIds=[];
    const original=structuredClone(historical),prepared=await prepareDispatchExecutionContext(f.w,historical);
    expect(prepared.modules.map(m=>m.binding)).toEqual(original.modules);
    expect(historical).toEqual(original);
    expect(()=>validatePreparedDispatchKnowledge(JSON.parse(JSON.stringify(prepared)))).not.toThrow();
    await expect(recheckDispatchExecutionContext(f.w,prepared)).resolves.toBeUndefined();
  }finally{await f.cleanup()}
});
