/**
 * 作用定位：为只读角色历史面板提供按需分页与单轮公开事件读取。
 * 设计原因：不轮询全量历史；每次手动刷新/加载更多串行执行，切换身份或卸载丢弃迟到响应，事件只补齐连续分页而不触发任何执行操作。
 */
import {useCallback,useEffect,useRef,useState} from 'react';
import type {AgentHistoryIdentity,AgentHistorySessionIdentity,AgentHistoryRun,AgentHistorySession,AgentHistoryPage,AgentHistoryEventsRead} from '../../bridge/contracts/agent-history';
import {applyMemberEvents,emptyMemberEvents,type MemberEventState} from '../tasks/member-event-state';
import {historyEventScope,historyRunKey,historyScopeKey,mergeHistoryPage} from './agent-history-state';

type Item=AgentHistorySession|AgentHistoryRun;
/** 调用方固定只读动作及身份；disabled 不读取，返回内容始终先核对当前作用域。 */
export function useHistoryPage<T extends Item>(action:'agentHistory.sessions'|'agentHistory.runs',identity:AgentHistoryIdentity|AgentHistorySessionIdentity,enabled:boolean){
  const key=historyScopeKey(identity);
  const [state,setState]=useState<{key:string;page?:AgentHistoryPage<T>;loading:boolean;error:string}>({key,loading:false,error:''});
  const controller=useRef<{key:string;pull:(append:boolean)=>Promise<void>}|undefined>(undefined);
  useEffect(()=>{
    let stopped=false,inFlight:Promise<void>|undefined,page:AgentHistoryPage<T>|undefined;
    const current={key,pull};controller.current=current;setState({key,loading:enabled,error:''});
    async function pull(append=false):Promise<void>{
      if(stopped||!enabled)return;if(inFlight)return inFlight;if(append&&!page?.nextCursor)return;
      setState(old=>old.key===key?{...old,loading:true,error:''}:old);
      inFlight=(async()=>{try{
        const requestedCursor=append?page?.nextCursor:undefined;
        const result=await window.cbim.call(action,{...identity,cursor:requestedCursor,limit:30}) as AgentHistoryPage<T>;
        if(stopped||controller.current!==current)return;
        if(requestedCursor&&result.nextCursor===requestedCursor)throw Error('执行历史分页未前进，请刷新后重试');
        page=mergeHistoryPage(page,result,identity,append);setState({key,page,loading:false,error:''});
      }catch(error){if(!stopped&&controller.current===current)setState(old=>({...old,key,loading:false,error:error instanceof Error?error.message:'执行历史读取失败，请重试'}))}
      finally{inFlight=undefined}})();return inFlight;
    }
    if(enabled)void pull();
    return()=>{stopped=true;if(controller.current===current)controller.current=undefined};
  },[key,action,enabled]);
  const refresh=useCallback(async()=>{if(controller.current?.key===key)await controller.current.pull(false)},[key]);
  const more=useCallback(async()=>{if(controller.current?.key===key)await controller.current.pull(true)},[key]);
  return {...(state.key===key?state:{key,loading:enabled,error:''}),refresh,more};
}

/** 只观察选中的一轮，补完已有事件后停止；刷新从已确认游标增量读取，绝不启动或恢复模型。 */
export function useHistoryEvents(record:AgentHistoryRun){
  const key=historyRunKey(record);
  const [state,setState]=useState<{key:string;projection:MemberEventState;loading:boolean;error:string}>(()=>({key,projection:emptyMemberEvents(historyEventScope(record)),loading:true,error:''}));
  const controller=useRef<{key:string;pull:()=>Promise<void>}|undefined>(undefined);
  useEffect(()=>{
    let stopped=false,inFlight:Promise<void>|undefined,projection=emptyMemberEvents(historyEventScope(record));
    const current={key,pull};controller.current=current;setState({key,projection,loading:true,error:''});
    async function pull():Promise<void>{
      if(stopped)return;if(inFlight)return inFlight;
      setState(old=>old.key===key?{...old,loading:true,error:''}:old);
      inFlight=(async()=>{try{
        let pages=0;
        do{
          const result=await window.cbim.call('agentHistory.events',{workspaceId:record.workspaceId,agentId:record.agentId,sessionId:record.sessionId,taskId:record.taskId,runId:record.runId,cursor:projection.cursor,limit:200}) as AgentHistoryEventsRead;
          if(stopped||controller.current!==current)return;
          const previous=projection.cursor?.seq??0;
          let next:MemberEventState;
          try{next=applyMemberEvents(projection,result)}catch(error){projection=emptyMemberEvents(historyEventScope(record));throw error}
          if(next.hasMore&&next.cursor?.seq===previous)throw Error('公开事件分页未前进，请重新读取');
          projection=next;setState({key,projection,loading:projection.hasMore,error:''});
          // 单次点击最多补 2 万条，长历史保留游标供继续加载，不用一次渲染占满页面。
          pages++;if(pages>=100)break;
        }while(projection.hasMore&&!stopped);
        if(!stopped)setState({key,projection,loading:false,error:''});
      }catch(error){if(!stopped&&controller.current===current)setState(old=>({...old,key,loading:false,error:error instanceof Error?error.message:'公开记录读取失败，请重试'}))}
      finally{inFlight=undefined}})();return inFlight;
    }
    void pull();return()=>{stopped=true;if(controller.current===current)controller.current=undefined};
  },[key]);
  const refresh=useCallback(async()=>{if(controller.current?.key===key)await controller.current.pull()},[key]);
  return {...(state.key===key?state:{key,projection:emptyMemberEvents(historyEventScope(record)),loading:true,error:''}),refresh};
}
