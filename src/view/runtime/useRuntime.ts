/**
 * 作用定位：把窗口共享的监管快照接入 React，并跟随文档可见性暂停后台读取。
 * 设计原因：外壳离开运行管理会卸载本订阅；窗口最小化/隐藏时也不持续轮询，恢复可见后按原游标补读。
 */
import {useCallback,useEffect,useState,useSyncExternalStore} from 'react';
import {RuntimeFeed} from './runtime-feed';
const feed=new RuntimeFeed(cursor=>window.cbim.call('runtime.read',{cursor}));
const snapshot=()=>feed.snapshot;
/** 可见性只控制查看，不停止或恢复真实任务。 */
export function useRuntimeVisibility(){const [visible,setVisible]=useState(()=>!document.hidden);useEffect(()=>{const change=()=>setVisible(!document.hidden);document.addEventListener('visibilitychange',change);return()=>document.removeEventListener('visibilitychange',change)},[]);return visible}
export function useRuntime(active:boolean){const subscribe=useCallback((listener:()=>void)=>active?feed.subscribe(listener):()=>{},[active]);return useSyncExternalStore(subscribe,snapshot,snapshot)}
export function refreshRuntime(){return feed.refresh()}
