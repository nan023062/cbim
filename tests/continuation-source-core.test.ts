import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {hash,json} from '../src/core/platform/node/serialization';
import {continuationSourceProofSchema,continuationSourceSnapshotSchema,continuationSourceLimits,type ContinuationSourceSnapshot} from '../src/logic/tasks/rules/continuation-source-snapshot';
import {continuationAttachmentManifestSchema,continuationAttachmentManifestV1Schema,continuationAttachmentManifestV2Schema,continuationSourceItemFromSnapshot,continuationSourceItemSchema,assertContinuationAttachmentManifest,type ContinuationAttachmentManifest,type ContinuationAttachmentManifestV1,type ContinuationAttachmentManifestV2} from '../src/logic/tasks/rules/scope-continuation-attachments';
import {scopeContinuationSchema,goalContinuationRequestSchema,goalContinuationReceiptSchema,type GoalContinuationRequest,type ScopeContinuation} from '../src/logic/tasks/rules/scope-continuation';
import {validateDispatchScopes} from '../src/logic/tasks/rules/dispatch-scope-invariants';
import {checkedRunInputSource} from '../src/logic/execution/rules/input-source';
import {checkedJsonToolResult} from '../src/logic/tools/rules/results';
import type {DispatchState} from '../src/logic/dispatch/rules/dispatch-storage';

const at='2026-11-07T10:00:00.000Z',acceptedAt='2026-11-07T10:00:01.000Z',digest=hash('captured');
const url='http://127.0.0.1:12345/reference';
function source(kind:ContinuationSourceSnapshot['kind'],text='资料内容'):ContinuationSourceSnapshot{
  const base={version:1 as const,id:randomUUID(),name:kind,source:kind==='web'||kind==='link'?url:'/private/source',text},common={capturedAt:at,savedTextBytes:Buffer.byteLength(text)};
  switch(kind){
    case 'folder':return {...base,kind,proof:{...common,kind,mode:'first_level',entryLimit:200,entryCount:1,truncated:false}};
    case 'link':return {...base,kind,proof:{...common,kind,mode:'url_only',url}};
    case 'web':return {...base,kind,proof:{...common,kind,url,mediaType:'text/html; charset=utf-8',rawBytes:128,rawHash:digest,extraction:'html_text',truncated:false}};
    case 'repository_resource':return {...base,kind,proof:{...common,kind,provider:'resource_repository_v1',connectorId:'.cbim/connectors/resources',repositoryId:randomUUID(),connectionId:randomUUID(),definitionHash:digest,grantRevision:1,revision:digest,resourceId:randomUUID(),resourceKind:'module',fullContentHash:hash(text),fullContentBytes:Buffer.byteLength(text),truncated:false,readOnly:true,transport:'http'}};
  }
}
function fileManifest():ContinuationAttachmentManifestV1{return {version:1,items:[{attachmentId:randomUUID(),kind:'file',name:'old.txt',contentKind:'text',byteLength:3,snapshotHash:digest,contentHash:hash('old')},{attachmentId:randomUUID(),kind:'file',name:'old.png',contentKind:'image',byteLength:8,mimeType:'image/png',snapshotHash:digest,contentHash:digest},{attachmentId:randomUUID(),kind:'file',name:'old.bin',contentKind:'reference',byteLength:3,snapshotHash:digest,contentHash:digest}],expandedMessageHash:digest,expandedMessageBytes:512}}
function sourceManifest():ContinuationAttachmentManifestV2{return {version:2,items:[...fileManifest().items,...(['folder','link','web','repository_resource'] as const).map(kind=>{const value=source(kind);return continuationSourceItemFromSnapshot(value,hash(JSON.stringify(value)),hash(value.text))})],expandedMessageHash:digest,expandedMessageBytes:4096}}
function waiting(){
  const identity={workspaceId:'workspace',rootSessionId:'root'},cursor={streamId:'stream',seq:1},main={agentId:'cbim:main',agentInstanceId:'instance',agentSessionId:'session',name:'主调度'},stamp={runId:'first',recordedAt:at,knowledgeRevision:'knowledge',graphCursor:cursor};
  const state:DispatchState={workspaceId:'workspace',members:[],sessions:[],runs:[],outbox:[],graphs:[{version:1,identity,cursor:{...identity,...cursor},root:{kind:'session-root',nodeId:'session:root',identity,agent:main,revision:1,createdAt:at},tasks:[],edges:[],agents:[{agentId:main.agentId,agentInstanceId:main.agentInstanceId,name:main.name,revision:1,state:'idle',waitingTaskIds:[]}]}],scopes:[{...identity,scopeId:'scope',createdAt:at,status:'waiting',runTracking:{version:1,mainRunIds:['first']},wait:{waitId:'wait',reason:'缺少资料',createdAt:at,runId:'first',goalRevision:3,graphCursor:cursor,knowledgeRevision:'knowledge',mainRunIds:['first']},goal:{revision:3,input:{message:'最初目标',attachmentIds:[]},plan:{...stamp,revision:2,objective:'保留原目标',constraints:[],criteria:[{id:'human',kind:'human',text:'等待真实补充'}],assignments:[{agentId:'cbim:main',agentName:'主调度',teamId:'team',moduleIds:[],moduleNames:[],criterionIds:['human'],reason:'管理目标'}],reason:'等待'},review:{...stamp,revision:3,planRevision:2,decision:'awaiting_user',checks:[{criterionId:'human',outcome:'needs_human',reason:'资料不全',evidence:[]}],superseded:[],gaps:['补充资料'],reason:'等待用户',observedSeq:2,lastEffectSeq:0}}}]};
  return state;
}
function supplement(before:DispatchState,manifest:ContinuationAttachmentManifest|undefined){
  const next=structuredClone(before),scope=next.scopes![0],input={message:'新增资料只供参考',...(manifest?{attachmentIds:manifest.items.map(item=>item.attachmentId)}:{})};
  const request:GoalContinuationRequest={workspaceId:'workspace',rootSessionId:'root',scopeId:'scope',waitId:'wait',expectedGoalRevision:3,expectedInputRevision:1,commandId:randomUUID(),input,options:{provider:'test',model:'model',profileId:randomUUID(),permission:'read'}};
  const record:ScopeContinuation={continuationId:request.commandId,acceptedAt,wait:structuredClone(scope.wait!),inputRevision:2,input,runId:'next',options:request.options,...(manifest?{attachmentManifest:manifest}:{})};
  delete scope.wait;scope.status='active';scope.runTracking!.mainRunIds.push('next');scope.goal={...scope.goal!,revision:4,inputRevision:2};delete scope.goal.review;scope.continuations=[record];
  return {next,scope,request,record,mutation:{scopes:[scope],receipt:true}};
}

it('v1 文件/图片/reference 和纯文本记录原样通过，不补来源、版本或默认字段',()=>{
  const value=fileManifest();expect(continuationAttachmentManifestSchema.parse(value)).toEqual(value);expect(checkedJsonToolResult('test-manifest',value,continuationAttachmentManifestV1Schema).content[0].text).toBe(JSON.stringify(value));
  expect(continuationAttachmentManifestV2Schema.safeParse({...value,version:2}).success).toBe(false);
  const before=waiting(),text=supplement(before,undefined);expect(scopeContinuationSchema.parse(text.record)).toEqual(text.record);expect(text.record).not.toHaveProperty('attachmentManifest');expect(text.request.input).not.toHaveProperty('attachmentIds');expect(()=>validateDispatchScopes(before,text.next,text.mutation)).not.toThrow();
});
it('混合来源 v2 同序保存，类型和部分性明确；公开清单不复制正文或目录路径',()=>{
  const value=sourceManifest();expect(continuationAttachmentManifestSchema.parse(value)).toEqual(value);expect(value.items.map(item=>item.contentKind)).toEqual(['text','image','reference','directory_listing','url_reference','web_excerpt','resource_excerpt']);
  expect(JSON.stringify(value)).not.toContain('/private/source');expect(JSON.stringify(value)).not.toContain('资料内容');
  expect(()=>assertContinuationAttachmentManifest({message:'补充',attachmentIds:value.items.map(item=>item.attachmentId)},value)).not.toThrow();
  expect(continuationAttachmentManifestV1Schema.safeParse({...value,version:1}).success).toBe(false);
});
it('私有来源快照必须有新版本和真实分支；旧 connector 定义及无证明资料不能补造成资源',()=>{
  for(const kind of ['folder','link','web','repository_resource'] as const){const value=source(kind);expect(continuationSourceSnapshotSchema.parse(value)).toEqual(value);
    for(const invalid of [{...value,version:undefined},{...value,proof:undefined},{...value,version:2},{...value,kind:'connector'},{...value,actor:{kind:'local_desktop'}},{...value,image:{type:'image',data:'fake'}}])expect(continuationSourceSnapshotSchema.safeParse(invalid).success).toBe(false);
  }
});
it('目录限首层 200 项，URL 指针不冒称抓取，网页媒体类型/原始响应和提取方式严格核对',()=>{
  const folder=source('folder').proof,link=source('link').proof,web=source('web').proof;
  for(const invalid of [{...folder,entryCount:201},{...folder,entryLimit:201},{...folder,mode:'recursive'},{...folder,recursive:true},{...link,mode:'fetched'},{...link,rawHash:digest},{...web,rawBytes:continuationSourceLimits.webResponseBytes+1},{...web,mediaType:'image/png'},{...web,extraction:'text'},{...web,scriptExecuted:false}])expect(continuationSourceProofSchema.safeParse(invalid).success).toBe(false);
  expect(continuationSourceProofSchema.safeParse({...folder,entryCount:200,truncated:true}).success).toBe(true);expect(continuationSourceProofSchema.safeParse({...web,rawBytes:continuationSourceLimits.webResponseBytes}).success).toBe(true);
  for(const invalidUrl of ['file:///secret','javascript:alert(1)','https://user:pass@example.com',' https://example.com','https://example.com\n'])expect(continuationSourceProofSchema.safeParse({...link,url:invalidUrl}).success).toBe(false);
});
it('保存文本按 UTF-8 64 KiB 而非字符截断；正文、来源地址和记录字节数须对应',()=>{
  const exact='汉'.repeat(21845)+'a',value=source('web',exact);expect(Buffer.byteLength(exact)).toBe(65536);expect(continuationSourceSnapshotSchema.safeParse(value).success).toBe(true);
  for(const invalid of [{...value,text:exact+'a'},{...value,proof:{...value.proof,savedTextBytes:exact.length}},{...value,source:'http://other.test/'},{...value,text:'different'}])expect(continuationSourceSnapshotSchema.safeParse(invalid).success).toBe(false);
});
it('仓库七类只记录真实 HTTP 静态正文，完整/截取指纹区分且不携带凭据或执行许可',()=>{
  const value=source('repository_resource');if(value.kind!=='repository_resource')throw Error();
  for(const resourceKind of ['connector','team','agent','skill','architecture','module','workflow'] as const)expect(continuationSourceSnapshotSchema.safeParse({...value,proof:{...value.proof,resourceKind}}).success).toBe(true);
  for(const proof of [{...value.proof,provider:'cindy_plugin'},{...value.proof,grantRevision:0},{...value.proof,connectorId:'../secret'},{...value.proof,resourceKind:'binary'},{...value.proof,readOnly:false},{...value.proof,transport:'local'},{...value.proof,token:'secret'},{...value.proof,execute:true},{...value.proof,fullContentBytes:1},{...value.proof,truncated:true},{...value.proof,fullContentBytes:continuationSourceLimits.resourceContentBytes+1}])expect(continuationSourceProofSchema.safeParse(proof).success).toBe(false);
  const item=continuationSourceItemFromSnapshot(value,digest,hash(value.text));expect(continuationSourceItemSchema.safeParse(item).success).toBe(true);expect(continuationSourceItemSchema.safeParse({...item,contentHash:hash('changed')}).success).toBe(false);
  const excerpt={...value,proof:{...value.proof,fullContentBytes:999,fullContentHash:digest,truncated:true}};expect(continuationSourceSnapshotSchema.safeParse(excerpt).success).toBe(true);expect(continuationSourceItemSchema.safeParse(continuationSourceItemFromSnapshot(excerpt,digest,hash(excerpt.text))).success).toBe(true);
});
it('清单拒绝跨种类证明、漏项、重排、重复、私有字段、伪造摘要及超出原展开/图片总额',()=>{
  const value=sourceManifest(),ids=value.items.map(item=>item.attachmentId),fresh=value.items.at(-1)!;if(fresh.kind==='file')throw Error();
  const invalid=[{...value,items:[...value.items].reverse()},{...value,items:value.items.slice(1)},{...value,items:[...value.items,fresh]},{...value,items:[...value.items.slice(0,-1),{...fresh,kind:'web'}]},{...value,items:[...value.items.slice(0,-1),{...fresh,contentKind:'text'}]},{...value,items:[...value.items.slice(0,-1),{...fresh,byteLength:0}]},{...value,items:[...value.items.slice(0,-1),{...fresh,source:'/private/path'}]},{...value,items:[...value.items.slice(0,-1),{...fresh,snapshotHash:'bad'}]},{...value,expandedMessageBytes:512*1024+1},{...value,expandedMessageBytes:1}];
  for(const candidate of invalid)expect(()=>assertContinuationAttachmentManifest({message:'补充资料',attachmentIds:ids},candidate)).toThrow();
  const image=value.items.find(item=>item.contentKind==='image')!;expect(continuationAttachmentManifestSchema.safeParse({...value,items:[fresh,...Array.from({length:5},()=>({...image,attachmentId:randomUUID(),byteLength:5*1024*1024}))]}).success).toBe(false);
  expect(()=>assertContinuationAttachmentManifest({message:'没有附件'},value)).toThrow();
});
it('IPC 只接受原 message/IDs，不接收来源证明、路径或 manifest；原 source hash 协议无需新增权限',()=>{
  const value=sourceManifest(),{request}=supplement(waiting(),value);expect(goalContinuationRequestSchema.parse(request)).toEqual(request);
  for(const extra of [{attachmentManifest:value},{proof:source('web').proof},{path:'/private/file'},{provider:'resource_repository_v1'}])expect(goalContinuationRequestSchema.safeParse({...request,input:{...request.input,...extra}}).success).toBe(false);
  const sourceValue={kind:'user-continuation' as const,continuationId:request.commandId,scopeId:'scope',waitId:'wait',inputRevision:2,attachmentManifestHash:hash(json(value))};expect(checkedRunInputSource(sourceValue)).toEqual(sourceValue);expect(()=>checkedRunInputSource({...sourceValue,proof:source('web').proof})).toThrow();
});
it('v2 真实资料清单沿原等待事务受理，仅升输入版本和登记新主轮，不改变原目标/图/权限',()=>{
  const before=waiting(),original=structuredClone(before),{next,scope,record,mutation,request}=supplement(before,sourceManifest());expect(()=>validateDispatchScopes(before,before,{receipt:true})).not.toThrow();expect(()=>validateDispatchScopes(before,next,mutation)).not.toThrow();
  expect(scope.goal!.input).toEqual(before.scopes![0].goal!.input);expect(scope.goal!.plan).toEqual(before.scopes![0].goal!.plan);expect(scope.goal!.review).toBeUndefined();expect(scope.runTracking!.mainRunIds).toEqual(['first','next']);expect(scope.goal!.inputRevision).toBe(2);expect(next.graphs).toEqual(before.graphs);expect(before).toEqual(original);
  const receipt={workspaceId:'workspace',rootSessionId:'root',scopeId:'scope',scopeStatus:'active',continuation:record};expect(goalContinuationReceiptSchema.parse(JSON.parse(JSON.stringify(receipt)))).toEqual(receipt);expect(record.options).toEqual(request.options);
});
it('持久历史不能删改证明或把 v1/v2 重新解释；普通图事务也不能重复消费/跨 scope 迁移',()=>{
  for(const value of [fileManifest(),sourceManifest()]){const {next:accepted}=supplement(waiting(),value),record=accepted.scopes![0].continuations![0] as ScopeContinuation;
    for(const alter of [(item:ScopeContinuation)=>{delete item.attachmentManifest},(item:ScopeContinuation)=>{item.attachmentManifest!.items[0].name='changed'},(item:ScopeContinuation)=>{item.attachmentManifest!.items.reverse()},(item:ScopeContinuation)=>{item.runId='another'},(item:ScopeContinuation)=>{item.input.attachmentIds!.reverse()}]){const next=structuredClone(accepted),scope=next.scopes![0];alter(scope.continuations![0] as ScopeContinuation);expect(()=>validateDispatchScopes(accepted,next,{scopes:[scope],receipt:true})).toThrow()}
    const duplicate=structuredClone(accepted);duplicate.scopes![0].continuations!.push(structuredClone(record));expect(()=>validateDispatchScopes(accepted,duplicate,{scopes:duplicate.scopes,receipt:true})).toThrow();
  }
});
it('new source 不绕过停止封存、budget 准入或接受后的旧计划失效；清单只记录资料',()=>{
  const before=waiting(),{next,mutation}=supplement(before,sourceManifest());
  const closed=structuredClone(before);closed.scopes![0].status='closed';closed.scopes![0].closedAt=acceptedAt;closed.scopes![0].outcome='cancelled';expect(()=>validateDispatchScopes(closed,next,mutation)).toThrow();
  const budgeted=structuredClone(before);budgeted.scopes![0].budget={version:1,policy:{revision:1,enabled:true,limits:{tokens:100}}};const attempt=supplement(budgeted,sourceManifest());expect(()=>validateDispatchScopes(budgeted,attempt.next,attempt.mutation)).toThrow();
  const unchangedReview=structuredClone(next);unchangedReview.scopes![0].goal!.review=before.scopes![0].goal!.review;expect(()=>validateDispatchScopes(before,unchangedReview,{scopes:unchangedReview.scopes,receipt:true})).toThrow();
});
