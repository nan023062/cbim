/**
 * 作用定位：将共享原文件操作/补偿控制器连接桌面 IPC，供成员原调用卡使用。
 * 设计原因：挂载只订阅本机状态，图和工作区实例变化仅使预览过期；当前文件读取与写入均由明确点击发起。
 */
import {useLayoutEffect,useMemo,useSyncExternalStore} from 'react';
import type {ControlledFileReportInput} from '../../bridge/contracts/controlled-files';
import {ControlledFilePool,controlledFileSelectionKey} from './controlled-file-state';

const controllers=new ControlledFilePool();
/** 稳定原命令跨页签/节点卸载保留；端口不接受任意路径、文件内容或私有证明。 */
export function controlledFileController(workspaceId:string,rootSessionId:string){return controllers.get(workspaceId,rootSessionId,{
  storage:{getItem:name=>window.localStorage.getItem(name),setItem:(name,value)=>window.localStorage.setItem(name,value)},uuid:()=>crypto.randomUUID(),
  report:input=>window.cbim.call('dispatch.controlledFileReport',input),preview:input=>window.cbim.call('dispatch.fileCompensationPreview',input),
  apply:input=>window.cbim.call('dispatch.fileCompensate',input),receipt:input=>window.cbim.call('dispatch.fileCompensationReceipt',input),
})}

/** anchor 只表示界面已观察的实例/图版本，真正内容与补偿资格由提交时后端重新核对。 */
export function useControlledFiles(identity:ControlledFileReportInput,instanceId:string|undefined,anchor:string){
  const controller=useMemo(()=>controlledFileController(identity.workspaceId,identity.rootSessionId),[identity.workspaceId,identity.rootSessionId]);
  const snapshot=useSyncExternalStore(controller.subscribe,()=>controller.snapshot,()=>controller.snapshot),key=controlledFileSelectionKey(identity),currentAnchor=JSON.stringify([instanceId??null,anchor]);
  useLayoutEffect(()=>controller.observeAnchor(identity,currentAnchor),[controller,key,currentAnchor]);
  return {controller,snapshot,read:snapshot.reads[key],draft:controller.draft(identity),attempt:controller.attempt(identity),fresh:controller.fresh(identity,instanceId)&&snapshot.reads[key]?.anchor===currentAnchor};
}
