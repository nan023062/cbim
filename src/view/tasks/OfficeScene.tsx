/**
 * 作用定位：当前主 Session 的办公室舞台、人物往返和对话导航，工位由真实模块投影。
 * 设计原因：人物只有一个 DOM 实体，沿已提交派发/汇报移动再回工位；动画结束仅清理本地播放队列，不调用执行接口。窄屏重排和减少动画不改变任务事实；侧栏身份只突出人物，不触发执行或重播动画。
 */
import {useEffect,useLayoutEffect,useMemo,useRef,useState,type CSSProperties} from 'react';
import type {GraphSnapshot,TeamSession,ScopeSummary} from '../../bridge/contracts/dispatch';
import {officeScene,OfficeEventTracker,type OfficeActor,type OfficeEvent} from './office-state';
import {Icon} from '../components/Icon';
import './office-scene.css';

export interface OfficeSceneProps {graph:GraphSnapshot;sessions?:readonly TeamSession[];scopes:readonly ScopeSummary[];mainRunning:boolean;queued:number;active?:boolean;selectedTaskId?:string;selectedAgentSessionId?:string;onChat:(sessionId?:string,scopeId?:string)=>void;onTask:(taskId:string)=>void}
/** 简单人物与办公家具使用同一主题，不依赖外部素材、图片加载或固定屏幕大小。 */
function Person({main,working}:{main:boolean;working:boolean}){return <svg className={'office-person-drawing'+(working?' working':'')} viewBox="0 0 58 70" aria-hidden="true"><ellipse cx="29" cy="65" rx="19" ry="4" className="office-shadow"/><path d="M20 42 L20 62 M38 42 L38 62" className="office-legs"/><path d="M16 32 Q29 24 42 32 L41 49 L17 49 Z" className={main?'office-shirt main':'office-shirt'}/><path d="M16 33 L10 47 M42 33 L48 47" className="office-arms"/><circle cx="29" cy="19" r="13" className="office-face"/><path d="M16 18 Q14 2 28 4 Q44 3 43 19 L36 11 L25 13 L19 11 Z" className="office-hair"/><circle cx="24" cy="20" r="1.3"/><circle cx="34" cy="20" r="1.3"/><path d="M25 26 Q29 29 33 26" className="office-smile"/>{main&&<path d="M28 32 L30 32 L32 40 L29 44 L26 40 Z" className="office-tie"/>}</svg>}
function Desk({lounge=false}:{lounge?:boolean}){return <svg className="office-furniture" viewBox="0 0 180 76" aria-hidden="true">{lounge?<><path d="M18 45 L162 45 L162 68 L18 68 Z" className="office-desk-top"/><rect x="14" y="30" width="152" height="22" rx="9" className="office-screen"/><path d="M26 67 L26 74 M154 67 L154 74" className="office-desk-legs"/></>:<><path d="M10 44 L170 44 L160 60 L20 60 Z" className="office-desk-top"/><path d="M23 60 L23 75 M157 60 L157 75" className="office-desk-legs"/><rect x="62" y="3" width="58" height="36" rx="4" className="office-monitor"/><rect x="67" y="8" width="48" height="25" rx="2" className="office-screen"/><path d="M91 39 L91 44 M79 44 L103 44" className="office-desk-legs"/><path d="M75 17 L84 22 L75 27 M91 27 L104 27" className="office-screen-lines"/><rect x="57" y="48" width="65" height="5" rx="2" className="office-monitor"/><path d="M143 43 L150 43 L150 35 L143 35 Z" className="office-cup"/></>}</svg>}

export function OfficeScene({graph,sessions,scopes,mainRunning,queued,active=true,selectedTaskId,selectedAgentSessionId,onChat,onTask}:OfficeSceneProps){
  const scene=useMemo(()=>officeScene(graph,sessions,scopes,mainRunning),[graph,sessions,scopes,mainRunning]);
  const tracker=useRef(new OfficeEventTracker()),[events,setEvents]=useState<OfficeEvent[]>([]),[notice,setNotice]=useState(''),[motion,setMotion]=useState(true),[reduced,setReduced]=useState(false);
  const stage=useRef<HTMLDivElement>(null),anchors=useRef(new Map<string,HTMLDivElement>()),[paths,setPaths]=useState<Record<string,{x:number;y:number}>>({});
  useEffect(()=>{const media=window.matchMedia?.('(prefers-reduced-motion: reduce)');if(!media)return;const update=()=>setReduced(media.matches);update();media.addEventListener('change',update);return()=>media.removeEventListener('change',update)},[]);
  useEffect(()=>{
    const incoming=tracker.current.observe(graph,active);if(!active||!motion||reduced)setEvents([]);
    if(incoming.length){setNotice(`${incoming.filter(event=>event.kind==='assignment').length} 项新派发 · ${incoming.filter(event=>event.kind==='feedback').length} 项新汇报`);if(active&&motion&&!reduced)setEvents(old=>[...old,...incoming].slice(-32))}
  },[graph,active,motion,reduced]);
  const actors=scene.actors;
  const actorFor=(event:OfficeEvent)=>event.kind==='assignment'?actors.find(actor=>actor.main):actors.find(actor=>actor.agentId===event.agentId);
  // 同一人物最多播放一条；不同成员可同时汇报，主 Agent 的派发按顺序表现。
  const playing=events.filter((event,index)=>{const actor=actorFor(event);return actor&&!events.slice(0,index).some(prior=>actorFor(prior)?.id===actor.id)});
  const playKey=playing.map(event=>event.id).join('|');
  useLayoutEffect(()=>{
    const measure=()=>{const next:Record<string,{x:number;y:number}>={};for(const event of playing){const actor=actorFor(event),target=actors.find(value=>event.kind==='assignment'?value.agentId===event.agentId:value.main);if(!actor||!target)continue;const origin=anchors.current.get(actor.id)?.getBoundingClientRect(),destination=anchors.current.get(target.id)?.getBoundingClientRect();if(origin&&destination)next[event.id]={x:destination.left-origin.left+(destination.width-origin.width)/2+(target.main?36:-36),y:destination.top-origin.top}}setPaths(next)};
    measure();const observer=typeof ResizeObserver==='undefined'?undefined:new ResizeObserver(measure);if(stage.current)observer?.observe(stage.current);return()=>observer?.disconnect();
  },[playKey,scene]);
  useEffect(()=>{if(!playing.length)return;const ids=new Set(playing.map(event=>event.id));const timer=setTimeout(()=>setEvents(old=>old.filter(event=>!ids.has(event.id))),3200);return()=>clearTimeout(timer)},[playKey]);
  const renderActor=(actor:OfficeActor)=>{
    const event=playing.find(event=>actorFor(event)?.id===actor.id),path=event?paths[event.id]:undefined;
    return <div key={actor.id} className="office-worker" data-selected={actor.sessionId===selectedAgentSessionId} data-office-actor={actor.id}>
      <div className="office-person-anchor" ref={node=>{if(node)anchors.current.set(actor.id,node);else anchors.current.delete(actor.id)}}>
        <div key={event?.id??'rest'} className={'office-person'+(path?' walking':'')} style={path?{'--walk-x':path.x+'px','--walk-y':path.y+'px'} as CSSProperties:undefined}>
          <button className="office-chat-bubble" onClick={()=>onChat(actor.sessionId,event?.scopeId??actor.scopeId)} aria-label={'打开 '+actor.name+' 的对话'} title={'打开 '+actor.name+' 的对话'}><Icon name="chat" size={15}/><span>{event?.label??'对话'}</span></button>
          <Person main={actor.main} working={actor.working&&!path&&motion&&!reduced}/><span className="office-name">{actor.name}</span>
        </div>
      </div>
      <span className={'office-work-state'+(actor.working?' working':'')}>{actor.state}</span>
      <p className="office-work-goal" title={actor.goal}>{actor.goal}</p>
      {actor.queued>0&&<small>同一 Agent 串行 · {actor.queued} 项待执行</small>}
      {actor.main&&<button className="office-task-link" onClick={()=>onTask(graph.root.nodeId)}>调度详情</button>}
      {actor.taskId&&<button className="office-task-link" onClick={()=>onTask(actor.taskId!)}>任务详情</button>}
    </div>;
  };
  return <section className="office-scene" aria-label="当前会话办公室" data-testid="office-scene">
    <div className="office-scene-bar"><span>{scene.actors.length} 位 Agent · {queued} 个排队话题</span><label><input type="checkbox" checked={motion&&!reduced} disabled={reduced} onChange={event=>setMotion(event.target.checked)}/>人物动态{reduced?'（系统减少动画）':''}</label></div>
    <p className="office-scene-note">每个人物对应一个会话；工位显示当前模块。移动表示已发生的派发或汇报，任务状态以文字为准。</p>
    <div className="office-floor" ref={stage}>
      <div className="office-room-sign">TEAM OFFICE <span>本主会话独享</span></div>
      {scene.desks.map(desk=><section key={desk.id} className={'office-station'+(desk.id==='main'?' coordinator':desk.id==='lounge'?' lounge':'')} data-desk-id={desk.id} aria-label={desk.name}>
        <h3>{desk.name}</h3><Desk lounge={desk.id==='lounge'}/><div className="office-workers">{scene.actors.filter(actor=>actor.deskId===desk.id).map(renderActor)}</div>
        {!scene.actors.some(actor=>actor.deskId===desk.id)&&<p className="office-station-idle">等待安排 / 关联模块</p>}
      </section>)}
    </div>
    <p className="office-event-notice" role="status" aria-live="polite">{notice||'等待新的派发与汇报事件；历史记录不重复播放。'}</p>
    <div className="office-current-tasks"><strong>当前任务 · {scene.current.length}</strong>{!scene.current.length&&<p>当前没有待处理任务</p>}{scene.current.map(task=><button data-task-id={task.taskId} key={task.taskId} onClick={()=>onTask(task.taskId)}>{task.assignee.name} · {task.goal}</button>)}</div>
    {!!scene.history.length&&<details className="office-history" open={scene.history.some(task=>task.taskId===selectedTaskId)}><summary>历史任务 · {scene.history.length}</summary>{scene.history.map(task=><button data-task-id={task.taskId} key={task.taskId} onClick={()=>onTask(task.taskId)}>{task.assignee.name} · {task.goal}</button>)}</details>}
  </section>;
}
