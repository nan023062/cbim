/**
 * 作用定位：按主对话 taskId 轮询本会话的派发图，只读 Snapshot/Delta 并向对话卡片和任务图提供同一投影。
 * 设计原因：不在渲染时创建调度业务；无图是正常空态，后台页签降频，单请求串行及作用域令牌避免重复读和串会话。
 */
import {useCallback,useEffect,useRef,useState} from 'react';
import type {GraphDelta,GraphSnapshot} from '../../bridge/contracts/dispatch';
import {SessionGraphProjection} from './graph-state';

/**
 * rootSessionId 缺省时不发请求；身份变化或卸载会丢弃旧响应，不停止后端任务。
 * active=false 降频且保留图，重新激活时立即补读；在途的手动刷新合并为下一次补读。
 */
export function useSessionGraph(workspaceId:string,rootSessionId?:string,active=true){
  const scope=JSON.stringify([workspaceId,rootSessionId]);
  const [state,setState]=useState<{scope:string;graph?:GraphSnapshot;loading:boolean;error:string}>({scope,loading:!!rootSessionId,error:''});
  const activeRef=useRef(active);activeRef.current=active;
  const previouslyActive=useRef(active);
  const trigger=useRef<()=>void>(()=>{});
  const refresh=useCallback(()=>trigger.current(),[]);
  useEffect(()=>{
    let stopped=false,inFlight=false,requested=false,reset=false,timer:ReturnType<typeof setTimeout>|undefined;
    const projection=new SessionGraphProjection({workspaceId,rootSessionId:rootSessionId??''});
    setState({scope,loading:!!rootSessionId,error:''});
    async function poll(){
      if(stopped||!rootSessionId)return;
      if(inFlight){requested=true;return}
      clearTimeout(timer);inFlight=true;let more=false;
      try{
        const result:GraphDelta=await window.cbim.call('dispatch.graphDelta',{identity:{workspaceId,rootSessionId},cursor:reset?undefined:projection.cursor,limit:100});
        if(stopped)return;
        const graph=projection.apply(result);reset=false;more=result.mode==='delta'&&result.hasMore;
        setState(old=>old.scope===scope&&old.graph===graph&&!old.loading&&!old.error?old:{scope,graph,loading:false,error:''});
      }catch(error){
        if(stopped)return;
        const message=error instanceof Error?error.message:String(error);
        // 新对话尚无派发图时保持空态；已存在的图突然消失则保留并提示，不能悄悄丢弃节点。
        const absent=message.includes('GRAPH_NOT_FOUND')&&!projection.snapshot;
        reset=!absent;
        setState(old=>({scope,graph:projection.snapshot,loading:false,error:absent?'':`任务图同步中断：${message}`}));
      }finally{
        inFlight=false;
        if(!stopped){const delay=more||requested?0:activeRef.current&&document.visibilityState!=='hidden'?1000:5000;requested=false;timer=setTimeout(()=>void poll(),delay)}
      }
    }
    trigger.current=()=>{void poll()};
    const visible=()=>{if(document.visibilityState==='visible'&&activeRef.current)void poll()};
    document.addEventListener('visibilitychange',visible);
    if(rootSessionId)void poll();
    return()=>{stopped=true;clearTimeout(timer);trigger.current=()=>{};document.removeEventListener('visibilitychange',visible)};
  },[scope,workspaceId,rootSessionId]);
  useEffect(()=>{if(active&&!previouslyActive.current)refresh();previouslyActive.current=active},[active,refresh]);
  return {graph:state.scope===scope?state.graph:undefined,loading:state.scope===scope?state.loading:!!rootSessionId,error:state.scope===scope?state.error:'',refresh};
}
