/**
 * 作用定位：在主会话层装配唯一补充控制器，向对话卡和任务根提供同一份草稿、提交锁及回执状态。
 * 设计原因：请求绑定原等待身份和会话可见代次；外壳保留隐藏会话时也撤销在途资料准备，迟到结果不能进入旧/新草稿。核实周期保持只读，挂载只查询未知命令，不自动续跑。
 * IPC 边界：任务详情与续接动态端口按操作解析后进入关联桥，状态所有权不变。
 */
import {checkedIpcCall} from '../../bridge/contracts/ipc-call';
import {useEffect,useMemo,useRef,useState} from 'react';
import type {GoalContinuationRequest} from '../../bridge/contracts/dispatch';
import type {ChatAttachment} from '../../bridge/contracts/chat';
import type {RepositoryToolTarget,RepositoryListOutput} from '../../bridge/contracts/repository-connections';
import type {ScopeGoalState} from './scope-state';
import {ScopeContinuationPool,type ContinuationDraft,type ContinuationTarget,type ContinuationSourceSelection,type ContinuationMaterialPage} from './continuation-state';
import {continuationSourcePorts} from './continuation-source-io';

// 同 renderer 的工作区切换不能产生两个写同一本机索引的在途控制器；真正重开应用仍从磁盘读取。
const controllers=new ScopeContinuationPool();

/** 模型身份由主输入区解析为实际供应商配置，补充附件与普通聊天输入独立；视觉能力由后端受理前复核。 */
export interface ContinuationModel {options:GoalContinuationRequest['options'];label:string}
/** 核实周期的只读约束来自真实开放周期，不受用户查看历史或切换输入区权限影响。 */
export function continuationModel(model:ContinuationModel|undefined,state:Pick<ScopeGoalState,'openScope'>):ContinuationModel|undefined{
  return model&&state.openScope?.readOnly?{options:{...model.options,permission:'read'},label:model.options.model+' · 只读核实'}:model;
}
export interface ScopeContinuationView {
  workspaceId:string;attachments:ChatAttachment[];importing:boolean;
  scopeId?:string;waitId?:string;text:string;record?:ContinuationDraft;
  editable:boolean;canSubmit:boolean;canRetry:boolean;pending:boolean;
  error:string;modelLabel:string;
  edit:(text:string)=>void;submit:()=>Promise<void>;query:()=>Promise<void>;retry:()=>Promise<void>;
  /** 显式将聊天草稿交给当前等待，成功返回表示可靠记录已接管草稿，不等于业务验收。 */
  submitInput:(text:string,attachments:readonly ChatAttachment[])=>Promise<void>;
  pickFiles:()=>Promise<void>;removeFile:(id:string)=>void;
  /** 随原等待身份/选择代次变化，用于清除表单未提交的来源选择。 */
  sourceSelectionKey:string;
  importSource:(selection:ContinuationSourceSelection)=>Promise<void>;
  materialTargets:()=>Promise<RepositoryToolTarget[]|undefined>;
  materialList:(selection:ContinuationMaterialPage)=>Promise<RepositoryListOutput|undefined>;
  cancelImport:()=>void;
}
/** 仅当前 waiting 且详情已与摘要核对时产生写入目标，模型等待申请和历史选择均不能构造恢复身份。 */
export function continuationTarget(workspaceId:string,rootSessionId:string|undefined,state:ScopeGoalState):ContinuationTarget|undefined{
  const scope=state.selectedScope,waiting=state.waitingScope;
  if(!rootSessionId||state.loading||state.detailLoading||state.error||!waiting||waiting.status!=='waiting'||waiting.scopeId!==state.selectedScopeId||scope?.scopeId!==waiting.scopeId||scope.status!=='waiting'||!scope.goal||!scope.wait||scope.wait.waitId!==waiting.wait?.waitId||scope.goal.revision!==waiting.goalRevision||scope.goal.revision!==scope.wait.goalRevision||(scope.goal.inputRevision??1)!==(waiting.inputRevision??1))return;
  if(scope.workspaceId!==workspaceId||scope.rootSessionId!==rootSessionId)return;
  return {workspaceId,rootSessionId,scopeId:scope.scopeId,waitId:scope.wait.waitId,expectedGoalRevision:scope.goal.revision,expectedInputRevision:scope.goal.inputRevision??1};
}

/** active 来自外壳的会话选择，不能用组件是否挂载替代；隐藏仅撤销未提交资料，不取消已经受理的目标继续。 */
export function useScopeContinuation(workspaceId:string,rootSessionId:string|undefined,state:ScopeGoalState,model:ContinuationModel|undefined,refresh:()=>void,active:boolean):ScopeContinuationView{
  const effectiveModel=continuationModel(model,state);
  const key=JSON.stringify([workspaceId,rootSessionId]),keyRef=useRef(key);keyRef.current=key;
  const refreshRef=useRef(refresh);refreshRef.current=refresh;
  const controller=useMemo(()=>rootSessionId?controllers.get(workspaceId,rootSessionId,{
    storage:{getItem:name=>window.localStorage.getItem(name),setItem:(name,value)=>window.localStorage.setItem(name,value)},
    submit:request=>window.cbim.call('loop.goalContinue',request),lookup:request=>window.cbim.call('loop.goalContinuation',request),uuid:()=>crypto.randomUUID(),
    pickFiles:()=>window.cbim.call('chat.pick',{id:workspaceId,kind:'file'}),
    ...continuationSourcePorts(workspaceId,(action,args)=>window.cbim.call(...checkedIpcCall(action,args)),()=>crypto.randomUUID()),
  }):undefined,[workspaceId,rootSessionId]);
  const [,changed]=useState(0);
  const mounted=useRef(false);
  useEffect(()=>{
    mounted.current=true;
    if(!controller)return;
    const unsubscribe=controller.subscribe(()=>changed(value=>value+1));
    void controller.restore().then(()=>{if(keyRef.current===key)refreshRef.current()});
    return ()=>{mounted.current=false;unsubscribe()};
  },[controller,key]);
  const target=active?continuationTarget(workspaceId,rootSessionId,state):undefined,records=controller?.snapshot.records??[];
  // 记录发生过的切换，即使选择器返回前又切回相同目标，也不把迟到文件自动附到恢复后的草稿。
  const stamp=JSON.stringify([key,active,target]),selection=useRef({stamp,generation:0});
  if(selection.current.stamp!==stamp)selection.current={stamp,generation:selection.current.generation+1};
  useEffect(()=>()=>{if(target)controller?.cancelImport(target)},[controller,stamp]);
  const record=target?controller?.record(target.scopeId,target.waitId):[...records].reverse().find(item=>item.scopeId===state.selectedScopeId);
  const pending=controller?.isPending(record)??false,attempt=record?.attempt,error=controller?.snapshot.error??'';
  const editable=!!target&&!!controller?.available&&!pending&&(!attempt||attempt.phase==='rejected');
  const importing=controller?.isImporting??false;
  const refreshAfter=async(work:()=>Promise<void>)=>{await work();if(keyRef.current===key)refreshRef.current()};
  const currentSelection=()=>{const generation=selection.current.generation;return ()=>mounted.current&&selection.current.generation===generation&&selection.current.stamp===stamp};
  return {
    workspaceId,attachments:record?.attachments??[],importing,
    scopeId:target?.scopeId??record?.scopeId,waitId:target?.waitId??record?.waitId,text:record?.text??'',record,
    editable,canSubmit:editable&&!importing&&!!effectiveModel&&!!record?.text.trim(),canRetry:!!target&&!pending&&attempt?.phase==='unknown',pending,error,
    modelLabel:attempt&&attempt.phase!=='rejected'?`${attempt.request.options.model} · ${{read:'只读访问',ask:'默认权限',execute:'完全访问'}[attempt.request.options.permission]}（本次提交已固定）`:effectiveModel?.label??'请先选择可用模型',
    edit:text=>{if(editable&&target)controller!.edit(target,text)},
    pickFiles:async()=>{if(!editable||!target||!controller)return;const generation=selection.current.generation;await controller.pickFiles(target,()=>mounted.current&&selection.current.generation===generation&&selection.current.stamp===stamp)},
    sourceSelectionKey:stamp+':'+selection.current.generation,
    importSource:async input=>{if(editable&&target&&controller)await controller.importSource(target,input,currentSelection())},
    materialTargets:async()=>editable&&target&&controller?controller.materialTargets(target,currentSelection()):undefined,
    materialList:async input=>editable&&target&&controller?controller.materialList(target,input,currentSelection()):undefined,
    cancelImport:()=>{if(target)controller?.cancelImport(target)},
    removeFile:id=>{if(editable&&target)controller!.removeFile(target,id)},
    submit:()=>refreshAfter(async()=>{if(editable&&target&&effectiveModel)await controller!.submit(target,effectiveModel.options)}),
    submitInput:(text,attachments)=>refreshAfter(async()=>{
      if(!editable||!target||!effectiveModel)throw Error('当前等待目标尚未就绪，请返回当前目标并核对补充记录。');
      await controller!.submitInput(target,effectiveModel.options,text,attachments);
    }),
    query:()=>refreshAfter(async()=>{if(record)await controller!.query(record.scopeId,record.waitId)}),
    retry:()=>refreshAfter(async()=>{if(target&&attempt?.phase==='unknown')await controller!.retry(target.scopeId,target.waitId)}),
  };
}
