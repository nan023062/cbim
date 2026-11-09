/**
 * 作用定位：按主对话 taskId 同步派发图、目标摘要和选中详情，为主对话和任务图提供同一投影与历史选择。
 * 设计原因：两条独立增量流在同一读取屏障返回；详情 stamp 避免反复传输大正文，选择历史不改变当前执行状态，后台降频及作用域令牌防止串会话。
 * 公共边界：选中详情使用显式公共周期类型；恢复来源可以展示，私有 context/native 隔离字段不进入 renderer。
 */
import {useCallback,useEffect,useRef,useState} from 'react';
import type {DispatchSessionRead,GraphSnapshot,ScopeSummary,PublicDispatchScope} from '../../bridge/contracts/dispatch';
import {SessionReadProjection,completeSessionRead,currentScope,scopeGoalView,type ScopeGoalState} from './scope-state';

/**
 * rootSessionId 缺省时不发请求；身份变化或卸载会丢弃旧响应，不停止后端任务。
 * active=false 降频且保留图，重新激活时立即补读；在途的手动刷新合并为下一次补读。开放/等待周期与历史选择分别返回，等待不等于模型运行。
 */
export function useSessionGraph(workspaceId:string,rootSessionId?:string,active=true):ScopeGoalState&{refresh:()=>void}{
  const scope=JSON.stringify([workspaceId,rootSessionId]);
  const [state,setState]=useState<{scope:string;graph?:GraphSnapshot;scopes:readonly ScopeSummary[];detail?:PublicDispatchScope;loading:boolean;error:string}>({scope,scopes:[],loading:!!rootSessionId,error:''});
  const [selection,setSelection]=useState<{scope:string;id?:string}>({scope});
  const selectionRef=useRef<string|undefined>(undefined);selectionRef.current=selection.scope===scope?selection.id:undefined;
  const activeRef=useRef(active);activeRef.current=active;
  const previouslyActive=useRef(active);
  const trigger=useRef<()=>void>(()=>{});
  const refresh=useCallback(()=>trigger.current(),[]);
  const selectScope=useCallback((id?:string)=>{selectionRef.current=id;setSelection({scope,id});trigger.current()},[scope]);
  useEffect(()=>{
    let stopped=false,inFlight=false,requested=false,reset=false,timer:ReturnType<typeof setTimeout>|undefined;
    const projection=new SessionReadProjection({workspaceId,rootSessionId:rootSessionId??''});
    setState({scope,scopes:[],loading:!!rootSessionId,error:''});
    async function poll(){
      if(stopped||!rootSessionId)return;
      if(inFlight){requested=true;return}
      clearTimeout(timer);inFlight=true;let more=false;
      try{
        const requestedScopeId=selectionRef.current;
        const result:DispatchSessionRead=await window.cbim.call('dispatch.sessionRead',{identity:{workspaceId,rootSessionId},graphCursor:reset?undefined:projection.graphCursor,scopeCursor:reset?undefined:projection.scopeCursor,selectedScopeId:requestedScopeId,detailStamp:reset?undefined:projection.detailStamp(requestedScopeId),limit:100});
        if(stopped)return;
        projection.apply(result,requestedScopeId);reset=false;more=result.graph.mode==='delta'&&result.graph.hasMore||result.scopes.mode==='delta'&&result.scopes.hasMore;
        // 任一流仍有分页时继续内部追赶，保留上一完整组合；避免完成目标和旧 running 节点同时发布。
        const complete=completeSessionRead(result,projection,selectionRef.current);
        if(complete){const {graph,scopes,detail}=complete;setState(old=>old.scope===scope&&old.graph===graph&&old.scopes===scopes&&old.detail===detail&&!old.loading&&!old.error?old:{scope,graph,scopes,detail,loading:false,error:''})}
      }catch(error){
        if(stopped)return;
        const message=error instanceof Error?error.message:String(error);
        // 新对话尚无派发图时保持空态；已存在的图突然消失则保留并提示，不能悄悄丢弃节点。
        const absent=message.includes('GRAPH_NOT_FOUND')&&!projection.graph;
        reset=!absent;
        // projection 可能已经追到某一条流的半页；异常只能标记旧 UI，不发布尚未追齐的内部状态。
        setState(old=>({...old,loading:false,error:absent?'':`任务与目标同步中断：${message}`}));
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
  const graph=state.scope===scope?state.graph:undefined,scopes=state.scope===scope?state.scopes:[],historyScopeId=selection.scope===scope?selection.id:undefined;
  const current=currentScope(scopes),selected=historyScopeId?scopes.find(item=>item.scopeId===historyScopeId):current;
  const detail=state.scope===scope&&state.detail?.scopeId===selected?.scopeId?state.detail:undefined;
  return {graph,scopes,selectedScopeId:selected?.scopeId,historyScopeId,selectedScope:detail,openScope:scopes.find(item=>item.status!=='closed'),activeScope:scopes.find(item=>item.status==='active'),waitingScope:scopes.find(item=>item.status==='waiting'),currentGoalView:scopeGoalView(current,graph),selectedGoalView:scopeGoalView(selected,graph),detailLoading:!!selected&&!detail,selectScope,loading:state.scope===scope?state.loading:!!rootSessionId,error:state.scope===scope?state.error:'',refresh};
}
