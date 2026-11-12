/**
 * 作用定位：由桌面外壳持有的一份更新状态，供账号菜单、提醒与更新弹窗共同消费。
 * 设计原因：入口切换不重建轮询或下载状态；只读本机 IPC，联网检查、下载、安装仍由独立 updater 负责。
 */
import {useCallback,useEffect,useRef,useState} from 'react';
import type {DesktopUpdateStatus} from '../../bridge/contracts/desktop-updates';

type UpdateAction='check'|'download'|'install';
/** 状态属于当前窗口；download 只准备包，install 才确认重启。关闭弹窗只改变显示，不重复派发安装。 */
export interface SoftwareUpdateController {
  status?:DesktopUpdateStatus;
  error:string;
  pending:boolean;
  refresh:()=>Promise<void>;
  act:(action:UpdateAction)=>Promise<void>;
}
const api=window.cbim;

/** 一个 App 挂载一次；操作前后的代际使旧查询不能覆盖新回执，下载期间仍可读取进度。 */
export function useSoftwareUpdates():SoftwareUpdateController {
  const [status,setStatus]=useState<DesktopUpdateStatus>(),[readError,setReadError]=useState(''),[actionError,setActionError]=useState(''),[pending,setPending]=useState(false);
  const alive=useRef(false),reading=useRef(false),acting=useRef(false),revision=useRef(0);
  const refresh=useCallback(async()=>{
    if(reading.current)return;reading.current=true;const request=revision.current;
    try{const next=await api.call('desktop.updates.status');if(alive.current&&request===revision.current){setStatus(next);setReadError('')}}
    catch{if(alive.current&&request===revision.current)setReadError('无法读取更新状态，请重试。')}
    finally{reading.current=false}
  },[]);
  useEffect(()=>{alive.current=true;void refresh();const timer=setInterval(()=>{if(!document.hidden)void refresh()},1000);
    return()=>{alive.current=false;revision.current++;clearInterval(timer)};
  },[refresh]);
  const act=useCallback(async(action:UpdateAction)=>{
    if(acting.current||!alive.current)return;acting.current=true;revision.current++;setPending(true);setActionError('');
    try{const next=await api.call(`desktop.updates.${action}`);if(alive.current){setStatus(next);setReadError('')}}
    catch{if(alive.current)setActionError('更新操作未能完成，请检查当前状态后重试。')}
    finally{revision.current++;acting.current=false;if(alive.current)setPending(false)}
  },[]);
  return {status,error:actionError||readError||status?.error||'',pending,refresh,act};
}
