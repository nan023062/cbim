/**
 * 作用定位：将共享影响处置控制器接到桌面 IPC，供主工具记录、成员详情与业务重规划使用。
 * 设计原因：同主会话只保留一份稳定请求索引；挂载无查询，用户点击才读原事实，普通轮询只使观察时效过期。
 */
import {useLayoutEffect,useMemo,useSyncExternalStore} from 'react';
import type {EffectObservationInput} from '../../bridge/contracts/effect-observation';
import {EffectObservationPool,effectSelectionKey} from './effect-observation-state';
const controllers=new EffectObservationPool();

/** 新任务表单与原调用卡共用同一明确选择，不自动读取或选择最近一条处置。 */
export function effectController(workspaceId:string,rootSessionId:string){return controllers.get(workspaceId,rootSessionId,{
  storage:{getItem:name=>window.localStorage.getItem(name),setItem:(name,value)=>window.localStorage.setItem(name,value)},uuid:()=>crypto.randomUUID(),
  observe:input=>window.cbim.call('dispatch.effectObserve',input),list:input=>window.cbim.call('dispatch.effectDispositionList',input),
  record:input=>window.cbim.call('dispatch.effectDisposition',input),receipt:input=>window.cbim.call('dispatch.effectDispositionReceipt',input),relations:input=>window.cbim.call('dispatch.effectRelations',input),
})}

/** 返回共享控制器及当前来源快照；anchor 是本地时效提示，不是后端授权。 */
export function useEffectObservation(identity:EffectObservationInput,anchor:string){
  const controller=useMemo(()=>effectController(identity.workspaceId,identity.rootSessionId),[identity.workspaceId,identity.rootSessionId]);
  const snapshot=useSyncExternalStore(controller.subscribe,()=>controller.snapshot,()=>controller.snapshot),key=effectSelectionKey(identity);
  useLayoutEffect(()=>controller.observeAnchor(identity,anchor),[controller,key,anchor]);
  return {controller,snapshot,read:snapshot.reads[key],draft:controller.draft(identity),attempt:controller.attempt(identity),selected:controller.selected(identity),fresh:controller.fresh(identity)&&snapshot.reads[key]?.anchor===anchor};
}
