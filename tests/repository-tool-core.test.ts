import {it,expect,vi} from 'vitest';
import {toolScopeSchema,repositoryToolScopeSchema,type RepositoryToolScope} from '../src/backend/core/tools/scope-schema';
import {repositoryListInputSchema,repositoryGetInputSchema,repositoryListOutputSchema,repositoryGetOutputSchema,repositoryToolTargetSchema} from '../src/backend/core/connectors/repository-tools';
import {authorizeRunTool,type RunToolDescriptor} from '../src/backend/core/policy/tool-policy';
import {toolReceipt} from '../src/backend/core/tools/receipts';
import type {ToolReceipt} from '../src/backend/core/tools/types';
import {executionReportSchema} from '../src/backend/core/tasks/execution-report';
import {TaskProgressTools} from '../src/backend/core/tasks/progress-tools';
import {evaluateWorkflowDelivery} from '../src/backend/core/tasks/workflow-evidence';
import {artifactSucceededCall,artifactSources,verifyArtifactBaselines,type ArtifactEvidenceEvent} from '../src/backend/core/tasks/artifact-evidence';
import type {WorkflowContractBinding} from '../src/backend/core/tasks/execution-context';
import {hash} from '../src/backend/core/foundation/serialization';

const connectorId='.cbim/connectors/resources',repositoryId='10000000-0000-0000-0000-000000000001',connectionId='20000000-0000-0000-0000-000000000001',resourceId='30000000-0000-0000-0000-000000000001';
const identity={workspaceId:'workspace',taskId:'task',runId:'run'},revision='a'.repeat(64);
const scope:RepositoryToolScope={kind:'repository',workspaceId:identity.workspaceId,connectorId,repositoryId,connectionId,operation:'get'};
const resource={id:resourceId,kind:'skill' as const,name:'资料',summary:'外部参考资料',updatedAt:'2026-11-07T00:00:00.000Z'};
const get={connectorId,expectedRevision:revision,resourceId};
const request={id:'repo-read',name:'cbim_repository_get',input:get};
const decision={allow:true,effects:['read'] as const,scope};

it('共享范围协议保留旧三种日志，仓库范围严格绑定身份及操作而无凭据',()=>{
  for(const kind of ['workspace','knowledge','unknown']){const old={kind,workspaceId:'workspace'};expect(toolScopeSchema.parse(old)).toEqual(old);expect(toolScopeSchema.safeParse({...old,repositoryId}).success).toBe(false)}
  expect(toolScopeSchema.parse(scope)).toEqual(scope);
  for(const value of [{...scope,url:'http://localhost'},{...scope,token:'secret'},{...scope,operation:'write'},{...scope,repositoryId:'repo'}, {...scope,connectionId:undefined},{...scope,connectorId:'.cbim/connectors/../x'}])expect(toolScopeSchema.safeParse(value).success).toBe(false);
  const receipt=toolReceipt(identity,request,decision,'succeeded',{text:'参考'});
  expect(executionReportSchema.shape.tools.shape.items.element.shape.receipt.unwrap().parse(receipt)).toEqual(receipt);
  expect(repositoryToolTargetSchema.parse({workspaceId:'workspace',connectorId,repositoryId,connectionId,name:'仓库',summary:'参考资料'})).not.toHaveProperty('grantRevision');
  expect(repositoryToolTargetSchema.safeParse({workspaceId:'workspace',connectorId,repositoryId,connectionId,name:'仓库',summary:'参考资料',token:'secret'}).success).toBe(false);
});

it('模型分页输入不接受可信身份、地址或授权，后续页与正文固定仓库版本',()=>{
  expect(repositoryListInputSchema.parse({connectorId})).toEqual({connectorId});
  expect(repositoryListInputSchema.safeParse({connectorId,offset:1}).success).toBe(false);
  expect(repositoryListInputSchema.safeParse({connectorId,offset:1,expectedRevision:revision,limit:50}).success).toBe(true);
  for(const extra of [{workspaceId:'forged'},{repositoryId},{connectionId},{scope},{token:'secret'},{permission:'execute'},{operation:'write'}]){
    expect(repositoryListInputSchema.safeParse({connectorId,...extra}).success).toBe(false);
    expect(repositoryGetInputSchema.safeParse({...get,...extra}).success).toBe(false);
  }
  expect(repositoryGetInputSchema.safeParse({...get,expectedRevision:undefined}).success).toBe(false);
  for(const limit of [0,4097,1.5])expect(repositoryGetInputSchema.safeParse({...get,limit}).success).toBe(false);
  for(const offset of [-1,1.5,Number.MAX_SAFE_INTEGER+1])expect(repositoryGetInputSchema.safeParse({...get,offset}).success).toBe(false);
  expect(repositoryListInputSchema.safeParse({connectorId,limit:51}).success).toBe(false);
});

it('目录摘要与分页有界，下一页标记和总数不能伪造',()=>{
  const output={scope:{...scope,operation:'list' as const},revision,offset:0,totalItems:2,items:[resource],nextOffset:1,readOnly:true};
  expect(repositoryListOutputSchema.parse(output)).toEqual(output);
  const invalid=[{...output,nextOffset:2},{...output,nextOffset:undefined},{...output,totalItems:0},{...output,items:[]},{...output,items:[resource,resource],nextOffset:undefined},{...output,items:[{...resource,name:'x'.repeat(101)}]},{...output,items:[{...resource,summary:'x'.repeat(1001)}]},{...output,items:[{...resource,content:'must not appear'}]}];
  for(const value of invalid)expect(repositoryListOutputSchema.safeParse(value).success).toBe(false);
  expect(repositoryListOutputSchema.safeParse({...output,totalItems:0,items:[],nextOffset:undefined}).success).toBe(true);
});

it('正文按Unicode codepoint有界，全文hash保留，末页不能冒充全文',()=>{
  const output={scope,revision,resource,content:{text:'甲😀',offset:0,totalCharacters:3,contentHash:hash('甲😀乙'),nextOffset:2,complete:false},readOnly:true};
  expect(repositoryGetOutputSchema.parse(output)).toEqual(output);
  const tail={...output,content:{...output.content,text:'乙',offset:2,nextOffset:undefined}};expect(repositoryGetOutputSchema.parse(tail)).toEqual(tail);
  expect(repositoryGetOutputSchema.safeParse({...tail,content:{...tail.content,complete:true}}).success).toBe(false);
  const complete={...output,content:{...output.content,text:'甲😀乙',nextOffset:undefined,complete:true}};expect(repositoryGetOutputSchema.parse(complete)).toEqual(complete);
  for(const content of [{...output.content,nextOffset:3},{...output.content,totalCharacters:1},{...output.content,text:''},{...output.content,text:'😀'.repeat(4097),totalCharacters:5000,nextOffset:4097},{...output.content,contentHash:'chunk-only-not-a-hash'},{...output.content,token:'secret'}])expect(repositoryGetOutputSchema.safeParse({...output,content}).success).toBe(false);
});

it('仓库描述只允许本轮已捕获的read，不触发业务审批或原生文件守卫',async()=>{
  const guard=vi.fn(async()=>({allow:true})),approve=vi.fn(async()=>({allow:true}));
  for(const permission of ['read','ask','execute'] as const){
    const result=await authorizeRunTool(request,{effects:['read'],native:false,scope},{workspaceId:identity.workspaceId,permission,guard,approve});
    expect(result.allow).toBe(true);expect(result.scope).toEqual(scope);expect(result.scope).not.toBe(scope);
  }
  expect(guard).not.toHaveBeenCalled();expect(approve).not.toHaveBeenCalled();
});

it('缺范围、错目标、错操作、跨工作区或假原生/写入描述均拒绝，不消费审批',async()=>{
  const guard=vi.fn(async()=>({allow:true})),approve=vi.fn(async()=>({allow:true})),context={workspaceId:identity.workspaceId,permission:'execute' as const,guard,approve};
  const descriptors:RunToolDescriptor[]=[
    {effects:['read'],native:false},{effects:['read'],native:false,scope:{kind:'workspace',workspaceId:'workspace'}},
    {effects:['read'],native:true,scope},{effects:['read','maintenance'],native:false,scope},{effects:['business-write'],native:false,scope},
    {effects:['read'],native:false,scope:{...scope,workspaceId:'other'}},{effects:['read'],native:false,scope:{...scope,operation:'list'}},
    {effects:['read'],native:false,scope:{...scope,connectorId:'.cbim/connectors/other'}},
  ];
  for(const descriptor of descriptors)expect((await authorizeRunTool(request,descriptor,context)).allow).toBe(false);
  expect((await authorizeRunTool({...request,name:'read',input:{path:'file'}},{effects:['read'],native:false,scope},context)).allow).toBe(false);
  expect(guard).not.toHaveBeenCalled();expect(approve).not.toHaveBeenCalled();
  const previous=await authorizeRunTool({id:'native',name:'read',input:{path:'file'}},{effects:['read'],native:true},context);expect(previous).toMatchObject({allow:true,scope:{kind:'workspace',workspaceId:'workspace'}});expect(guard).toHaveBeenCalledTimes(1);
});

it('仓库成功回执保留canonical身份，但不能作为任务步骤或Workflow交付证据',async()=>{
  const tools=new TaskProgressTools(undefined,async()=>{}),remote=toolReceipt(identity,request,decision,'succeeded',{text:'资料'});
  await tools.call('cbim_task_plan',{expectedVersion:0,goal:'业务目标',reason:'执行业务',acceptance:['读取业务文件'],steps:[{id:'s',title:'核实成果',owner:'executor'}]});
  const variants=[remote,{...remote,toolName:'read'},{...remote,scope:{kind:'workspace' as const,workspaceId:'workspace'}}];
  for(const receipt of variants)tools.record(receipt,tools.generation);
  await expect(tools.call('cbim_task_step',{expectedVersion:1,id:'s',state:'reported_done',evidenceIds:[remote.toolCallId]})).rejects.toThrow('证据不存在');
  const binding:WorkflowContractBinding={moduleId:'module',workflowId:'module/flow',workflowVersion:'version',contract:{version:1,delivery:{requiredToolEvidence:[{id:'read-file',toolName:'read'}]}}};
  for(const receipt of variants)expect(()=>evaluateWorkflowDelivery([binding],[receipt],identity)).toThrow();
  const local:ToolReceipt={...remote,toolName:'read',toolCallId:'local',scope:{kind:'workspace',workspaceId:'workspace'}};tools.record(local,tools.generation);
  await expect(tools.call('cbim_task_step',{expectedVersion:1,id:'s',state:'reported_done',evidenceIds:['local']})).resolves.toBeDefined();
  expect(evaluateWorkflowDelivery([binding],[local],identity).checks[0].toolCallIds).toEqual(['local']);
});

it('共用成功链可解析真实外部read，但单文件采集拒绝，文件基线不得洗白外部来源',()=>{
  const result={content:[{type:'text',text:'参考资料'}]},receipt=toolReceipt(identity,request,decision,'succeeded',result);
  const events:ArtifactEvidenceEvent[]=[
    {...identity,seq:1,type:'tool.proposed',data:request},
    {...identity,seq:2,type:'tool.allowed',data:{...request,...decision}},
    {...identity,seq:3,type:'tool.finished',data:{id:request.id,name:request.name,result,receipt}},
  ];
  const binding={...identity,rootSessionId:'root',agentId:'executor',teamId:'team',agentInstanceId:'instance',agentSessionId:'session',leaseEpoch:1,planRevision:1};
  expect(artifactSucceededCall(events,identity,request.id).receipt.scope).toEqual(scope);
  expect(()=>artifactSources(events,binding,[request.id])).toThrow();
  expect(verifyArtifactBaselines(events,binding,'knowledge',value=>value)).toMatchObject({impact:'unknown',issues:[{code:'ARTIFACT_EXTERNAL_SOURCE'}]});
  const forged=structuredClone(events);for(const event of forged)event.data.name='read';forged[0].data.input={path:'file.txt'};forged[1].data.input={path:'file.txt'};
  forged[2].data.receipt=toolReceipt(identity,{...request,name:'read',input:{path:'file.txt'}},decision,'succeeded',result);
  expect(()=>artifactSources(forged,binding,[request.id])).toThrow('工作区文件');
  expect(repositoryToolScopeSchema.parse(scope).operation).toBe('get');
});
