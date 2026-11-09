/**
 * 作用定位：来源事件与岗位/责任采纳的同事务许可，连接纯来源日志和 DispatchStore。
 * 设计原因：先验证完整 capture 与精确消费者，再给旧单域门禁一个窄许可；有 sourceChanges 字段本身不构成授权。
 * 职责边界：prepare/resolve 不混其他领域写入，capture 只许一条同来源采纳，不触碰执行图、实例或原知识正文。
 */
import {fail} from '../foundation/errors';
import {workspaceMemberChangeSchema} from '../team/workspace-member';
import {workspaceMemberCapabilityHash} from '../team/workspace-member-rules';
import {moduleOwnershipChangeSchema,isModuleOwnershipSourceAdoption} from '../workspace/module-ownership';
import {sourceRefMatches,sourceSelectionMatches,type KnowledgeSourceCapture,type CapabilitySourceRef,type SourceSelection} from '../workspace/knowledge-source';
import {applyKnowledgeSourceChange,knowledgeSourceCanonical,knowledgeSourceCommand,knowledgeSourceReceipt,knowledgeSourceRef,knowledgeSourcePending,validateKnowledgeSourceSelection,type KnowledgeSourceRegistry} from '../workspace/knowledge-source-rules';
import type {DispatchState,DispatchMutation,DispatchCommand} from './dispatch-storage';

/** 只由本模块完整核验后返回；消费者仍须核全部原审计、actor、basis 与回执。 */
export interface KnowledgeSourceCapturePermit {kind:'workspace_member'|'module_ownership';changeId:string;captureChangeId:string}
const equal=(a:unknown,b:unknown)=>knowledgeSourceCanonical(a)===knowledgeSourceCanonical(b);
function check(value:unknown,message:string,code='SOURCE_AUDIT'):asserts value{if(!value)fail(code,message)}

/** 验证单条来源事件及所有来源消费者；不读取知识或反向等待 Store。 */
export function projectKnowledgeSourceMutation(previous:DispatchState,mutation:DispatchMutation,command:DispatchCommand){
  check(!['knowledgeSourceGenerations','knowledgeSourceTransitions','sourceCursor'].some(key=>Object.hasOwn(mutation,key)),'来源投影不能直接写入');
  let projection={knowledgeSourceGenerations:previous.knowledgeSourceGenerations??[],knowledgeSourceTransitions:previous.knowledgeSourceTransitions??[],knowledgeSourceChanges:previous.knowledgeSourceChanges??[],sourceCursor:previous.sourceCursor??null};
  let capture:KnowledgeSourceCapture|undefined,permit:KnowledgeSourceCapturePermit|undefined;
  if(mutation.knowledgeSourceChanges!==undefined){
    check(Array.isArray(mutation.knowledgeSourceChanges)&&mutation.knowledgeSourceChanges.length===1,'来源事务必须恰好追加一条事件');
    const event=mutation.knowledgeSourceChanges[0];projection=applyKnowledgeSourceChange(previous,event);
    if(event.kind==='capture'){
      capture=event;const key=event.consumer.kind==='workspace_member'?'workspaceMemberChanges':'ownershipChanges',events=mutation[key];
      check(Object.keys(mutation).every(name=>name==='knowledgeSourceChanges'||name===key||name==='receipt')&&Array.isArray(events)&&events.length===1&&events[0]?.changeId===event.consumer.changeId&&events[0]?.committedAt===event.recordedAt,'捕获必须与唯一明确消费者同事务且同一提交时间');
      permit={kind:event.consumer.kind,changeId:event.consumer.changeId,captureChangeId:event.changeId};
    }else{
      check(Object.keys(mutation).every(name=>name==='knowledgeSourceChanges'||name==='receipt'),'来源准备/结算不得夹带其他变化');
      const expected=knowledgeSourceCommand(event);check(command.commandId===expected.commandId&&command.fingerprint===expected.fingerprint&&equal(mutation.receipt,knowledgeSourceReceipt(event)),'来源事件与原命令或回执不一致');
    }
  }else check(!command.commandId.startsWith('knowledge-source-'),'来源命令缺少审计');
  const projected:KnowledgeSourceRegistry={workspaceId:previous.workspaceId,...projection};
  const consume=(selection:SourceSelection|undefined,ref:CapabilitySourceRef|undefined,old:CapabilitySourceRef|undefined,source:{kind:'agent'|'module';sourceId:string}|'cbim:executor',selected:boolean,consumerKind:KnowledgeSourceCapturePermit['kind'],consumerId:string)=>{
    if(!selected){check(!selection&&equal(ref,old),'未选择的能力/责任变更不能改写来源');return;}
    check(!knowledgeSourcePending(previous),'知识来源尚待结算，不能采纳','SOURCE_PENDING');
    if(!selection){
      // 旧日志在首次追踪前没有 selection/ref；保留原形，不把来源身份补造给它。
      check(!ref&&!old&&!previous.sourceCursor&&!capture,'缺少明确来源采纳依据');return;
    }
    check(ref&&sourceSelectionMatches(selection,previous.workspaceId,source)&&sourceRefMatches(ref,previous.workspaceId,source),'采纳来源与消费者身份不一致');
    if(selection.kind==='workspace'&&selection.expectedRef===null)check(capture&&capture.consumer.kind===consumerKind&&capture.consumer.changeId===consumerId&&equal(knowledgeSourceRef(capture.generation),ref)&&equal(capture.observation,selection.observation),'未追踪来源必须与精确捕获原子采纳');
    else check(!capture,'已有代次或内置来源不应产生工作区捕获');
    validateKnowledgeSourceSelection(projected,selection,ref);
  };
  if(mutation.workspaceMemberChanges?.length===1){
    const event=mutation.workspaceMemberChanges[0];check(workspaceMemberChangeSchema.safeParse(event).success,'岗位来源消费者结构无效');
    const input=event.request.change,old=previous.workspaceMembers?.find(item=>item.memberId===event.next.memberId),configuration=event.next.adoption.configuration;
    const selected=input.kind==='register'||input.kind==='adopt'&&input.target==='capability';
    consume(event.sourceSelection,event.next.adoption.sourceRef,old?.adoption.sourceRef,configuration.source==='builtin'?'cbim:executor':{kind:'agent',sourceId:configuration.agentId},selected,'workspace_member',event.changeId);
    if(event.sourceSelection?.kind==='builtin')check(event.sourceSelection.ref.contentHash===workspaceMemberCapabilityHash(configuration),'内置来源内容指纹不匹配');
    if(event.sourceSelection?.kind==='workspace')check(event.sourceSelection.observation.knowledgeRevision===event.next.adoption.knowledgeRevision,'岗位采纳与来源观察知识版本不一致');
  }
  if(mutation.ownershipChanges?.length===1){
    const event=mutation.ownershipChanges[0];check(moduleOwnershipChangeSchema.safeParse(event).success,'责任来源消费者结构无效');
    const input=event.request.change,old=previous.moduleOwnerships?.find(item=>item.moduleId===input.moduleId),selected=!!input.nextOwner||isModuleOwnershipSourceAdoption(input);
    consume(event.sourceSelection,event.next.sourceRef,old?.sourceRef,{kind:'module',sourceId:input.moduleId},selected,'module_ownership',event.changeId);
    if(event.sourceSelection){check(event.sourceSelection.kind==='workspace'&&event.sourceSelection.observation.knowledgeRevision===event.next.observedModule.knowledgeRevision&&event.sourceSelection.observation.definitionHash===event.next.observedModule.definitionHash,'责任采纳与真实模块观察不一致');}
  }
  return {projection,permit};
}
