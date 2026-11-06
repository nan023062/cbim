/**
 * 作用定位：会话队列的独立增量刷新入口，覆盖轮询和用户操作后的即时同步。
 * 设计原因：不等待整段历史日志读取；请求序号及作用域拒绝晚到响应，失败保留当前列表并提示。
 */
import {useCallback,useEffect,useRef,useState} from 'react';
import {QueueProjection} from './queue-sync';
import type {QueuedMessage} from '../../bridge/contracts/execution';
export function useMessageQueue(workspaceId:string,taskId?:string){
 const [items,setItems]=useState<QueuedMessage[]>([]),[error,setError]=useState('');
 const state=useRef({scope:'',sequence:0,projection:new QueueProjection()});
 const scope=workspaceId+':'+(taskId??'');
 const refresh=useCallback(async()=>{
  const current=state.current;if(current.scope!==scope||!taskId)return;
  const sequence=++current.sequence;
  try{const delta=await window.cbim.call('loop.queueDelta',{id:workspaceId,taskId,cursor:current.projection.cursor});
   if(state.current!==current||sequence!==current.sequence)return;
   setItems(current.projection.apply(delta));setError('');
  }catch(e:any){if(state.current===current&&sequence===current.sequence)setError(e.message)}
 },[scope,workspaceId,taskId]);
 /** 修改开始时作废在途轮询；成功或失败后都重新读取权威版本。 */
 const invalidate=useCallback(()=>{state.current.sequence++},[]);
 useEffect(()=>{const current={scope,sequence:0,projection:new QueueProjection()};state.current=current;setItems([]);setError('');let stopped=false,timer:ReturnType<typeof setTimeout>;
  async function poll(){await refresh();if(!stopped)timer=setTimeout(()=>void poll(),1000)}
  if(taskId)void poll();return()=>{stopped=true;current.sequence++;clearTimeout(timer);if(state.current===current)state.current={scope:'',sequence:0,projection:new QueueProjection()}};
 },[scope,taskId,refresh]);
 return {items:state.current.scope===scope?items:[],error,refresh,invalidate};
}
