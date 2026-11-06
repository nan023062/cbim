/**
 * 作用定位：按成员运行身份轮询公开流式事件，支持卡片预览与任务详情的增量读取。
 * 设计原因：串行分页避免每秒重复回读全量日志；作用域代际丢弃晚到响应，后台降频，结算且分页读完后停止轮询。卸载只结束观察，不停止成员。
 */
import {useCallback,useEffect,useRef,useState} from 'react';
import {applyMemberEvents,emptyMemberEvents,memberEventKey,memberPollDelay,type MemberEventState} from './member-event-state';

/**
 * enabled 或身份变化会重建观察投影；enabled=false 不读取，active=false 仅降频并保留游标。
 * refresh 与在途请求合并，不额外排队；卸载丢弃迟到响应，不取消后端执行，也不撤回已发出的读取。
 */
export function useMemberRun(workspaceId:string,rootSessionId:string,taskId:string,runId?:string,enabled=true,active=true){
  const scope={workspaceId,rootSessionId,taskId,runId:runId??''},key=memberEventKey(scope);
  const [state,setState]=useState<MemberEventState>(()=>emptyMemberEvents(scope)),[error,setError]=useState<{key:string;text:string}>({key,text:''});
  const current=useRef<{key:string;refresh:()=>Promise<void>}|undefined>(undefined);
  const activeRef=useRef(active);activeRef.current=active;
  const refresh=useCallback(async()=>{if(current.current?.key===key)await current.current.refresh()},[key]);
  useEffect(()=>{
    let stopped=false,timer:ReturnType<typeof setTimeout>|undefined,inFlight:Promise<void>|undefined,projection=emptyMemberEvents(scope);
    const controller={key,refresh:pull};current.current=controller;setState(projection);setError({key,text:''});
    async function pull():Promise<void>{
      if(stopped||!enabled||!runId)return;
      if(inFlight)return inFlight;
      clearTimeout(timer);
      inFlight=(async()=>{
        let failed=false;
        try{
          const reply=await window.cbim.call('dispatch.executionEvents',{workspaceId,rootSessionId,taskId,runId,cursor:projection.cursor,limit:200});
          if(stopped||current.current!==controller)return;
          let next:MemberEventState;
          // 协议错误只清空下次请求的游标；界面保留已展示正文并提示，等待权威 reset 恢复。
          try{next=applyMemberEvents(projection,reply)}catch(cause){projection=emptyMemberEvents(scope);throw cause}
          if(next!==projection){projection=next;setState(next)}setError(old=>old.key===key&&!old.text?old:{key,text:''});
        }catch(cause){failed=true;if(!stopped&&current.current===controller)setError({key,text:cause instanceof Error?cause.message:'成员运行读取失败，请重试'})}
        finally{
          inFlight=undefined;
          const nextDelay=memberPollDelay(projection,!activeRef.current||document.visibilityState==='hidden',failed);
          if(!stopped&&enabled&&runId&&nextDelay!==undefined)timer=setTimeout(()=>void pull(),nextDelay);
        }
      })();
      return inFlight;
    }
    const visible=()=>{if(document.visibilityState==='visible')void pull()};
    if(enabled&&runId)void pull();document.addEventListener('visibilitychange',visible);
    return()=>{stopped=true;clearTimeout(timer);document.removeEventListener('visibilitychange',visible);if(current.current===controller)current.current=undefined};
  },[workspaceId,rootSessionId,taskId,runId,key,enabled]);
  useEffect(()=>{if(active)void refresh()},[active,refresh]);
  const matching=memberEventKey(state.scope)===key;
  return {run:matching?state.run:undefined,loading:!!runId&&enabled&&(!matching||!state.run),hasMore:matching&&state.hasMore,error:error.key===key?error.text:'',refresh};
}
