import {expect,it} from 'vitest';
import {PiEngine} from '../src/backend/engines/pi/engine';
import type {EngineEvent} from '../src/logic/execution/rules/types';

it.each([
  {stopped:true,error:'This operation was aborted',status:'cancelled',stopReason:'aborted'},
  {stopped:false,error:'This operation was aborted',status:'failed',stopReason:'error'},
  {stopped:true,error:'Provider authentication failed',status:'failed',stopReason:'error'},
])('only classifies a known abort response as cancellation after an explicit stop: $stopped / $error',async({stopped,error,status,stopReason})=>{
  const events:EngineEvent[]=[];let outcome:unknown;
  // Exercise the event adapter, without a process or model: transport emits this exact failure after aborting a pending approval.
  const engine=new PiEngine({process:{command:'unused',args:[]},agentHome:'unused',provider:'unused',model:'unused',prompt:'unused',knowledge:{list:async()=>[],call:async()=>({content:[]})}}) as any;
  engine.context={emit:async(event:EngineEvent)=>{events.push(event)}};engine.stopped=stopped;
  engine.settlement={resolve:(result:unknown)=>{outcome=result}};
  await engine.consume({type:'message_end',message:{role:'assistant',content:[],stopReason:'error',errorMessage:error}});
  await engine.consume({type:'agent_settled',aborted:stopped});
  expect(outcome).toMatchObject({status});expect(events[0].data.stopReason).toBe(stopReason);
  if(status==='failed')expect(outcome).toMatchObject({error});
});
