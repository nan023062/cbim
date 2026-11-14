// Isolated renderer fixture: real views and source IO service; governance and ownership are explicit test doubles.
import React,{useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {TeamView} from '../src/view/team/TeamView';
import {BusinessArchitecture} from '../src/view/workspace/WorkspaceView';
import '../src/view/shell/shell.css';
const snapshot=await fetch('/fixture/snapshot').then(r=>r.json());
const state=(window as any).treeFixture={calls:[],delay:false,pending:[],unexpected:[]};
const identity={workspaceId:snapshot.workspaceId,instanceId:snapshot.instanceId};
window.cbim={call:async(action:string,args:any)=>{
 state.calls.push({action,args});
 if(action==='source.list'||action==='source.read'){
  const response=await fetch('/fixture/'+action,{method:'POST',body:JSON.stringify(args)}),result=await response.json();
  if(!result.ok)throw Error(result.error);
  if(state.delay&&action==='source.read'&&args.path==='slow.ts')await new Promise(resolve=>state.pending.push(resolve));
  return result.value;
 }
 if(action==='workspace.members.list')return {identity,registryCursor:null,offset:0,total:0,items:[]};
 if(action==='workspace.ownerships.list')return {identity,readOnly:true,checkedAt:'2026-11-15T00:00:00.000Z',basis:{ownershipCursor:null,memberRegistryCursor:null,knowledgeRevision:'a'.repeat(64)},offset:0,total:0,items:[]};
 if(action==='loop.chat')throw Error('模拟通信中断');
 if(action==='preview')return {validation:{structural:true,issues:[]},request:args,diff:'fixture draft'};
 state.unexpected.push(action);throw Error('Unexpected fixture action '+action);
}} as any;
function Fixture(){
 const [tab,setTab]=useState('team'),dirty=useRef(new Set<string>()),workspace={id:snapshot.workspaceId,instanceId:snapshot.instanceId,name:'源码浏览验收',path:'isolated fixture',state:'running',tasks:[]};
 return <main style={{height:'100vh',overflow:'auto',minWidth:0}}><nav><button onClick={()=>setTab('team')}>团队测试</button><button onClick={()=>setTab('business')}>业务测试</button></nav>
 {tab==='team'?<TeamView snapshot={snapshot} workspace={workspace} dirty={dirty} tabId="team"/>:<BusinessArchitecture snapshot={snapshot} workspace={workspace} dirty={dirty} tabId="business"/>}
 </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
