/**
 * 作用定位：将当前窗口唯一的准入快照订阅接入 React，供多个会话与设置共用。
 * 设计原因：每秒最多一次游标查询，隐藏会话不维持独立轮询；IPC 只读投影，未把前端挂载变成启动或恢复入口。
 */
import {useCallback,useSyncExternalStore} from 'react';
import {AdmissionFeed} from './admission-state';
const feed=new AdmissionFeed(cursor=>window.cbim.call('admission.read',{cursor}));
const snapshot=()=>feed.snapshot;
/** active 为当前页面可见性；不订阅时仍返回最近已确认快照，但不会触发执行。 */
export function useAdmission(active=true){
  const subscribe=useCallback((listener:()=>void)=>active?feed.subscribe(listener):()=>{},[active]);
  return useSyncExternalStore(subscribe,snapshot,snapshot);
}
/** 保存设置后按需刷新，已有在途请求会复用而不是并发再读。 */
export function refreshAdmission(){return feed.refresh()}
