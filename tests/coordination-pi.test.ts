import {expect,it,vi} from 'vitest';
import Ajv from 'ajv';
import http from 'node:http';
import {fixture} from './helpers';
import {seedWorkspaceMembers,commitWorkspaceMember} from './workspace-member-fixture';
import {knowledgeContractResult} from './knowledge-contract-provider';

it('真实 Pi 统一责任快照和原回执可达，过期依据不给重试许可，连续三次失败熔断',async()=>{
 const f=await fixture(),errors:string[]=[],requests:any[]=[];let moduleId='',change:any,commit:any;
 const server=http.createServer(async(req,res)=>{try{
  let raw='';for await(const chunk of req)raw+=chunk;
  const body=JSON.parse(raw),turn=requests.length;requests.push(body);
  const names=body.tools.map((tool:any)=>tool.function.name);
  expect(names).toEqual(expect.arrayContaining(['cbim_state_inspect','cbim_receipt_inspect','cbim_agent_call']));expect(names).not.toContain('cbim_goal_plan');
  if(turn===0)for(const tool of body.tools.filter((item:any)=>['cbim_state_inspect','cbim_receipt_inspect'].includes(item.function.name)))new Ajv({strict:false,validateFormats:false}).compile(tool.function.parameters);
  const previous=turn?knowledgeContractResult(body,'call-'+(turn-1)):undefined;
  let name='cbim_module_owner_change_commit',args:unknown=commit;
  if(turn===0){name='cbim_state_inspect';args={target:'owner',input:{members:true,limit:20}}}
  else if(turn===1){expect(previous.memberPage.total).toBe(1);const member=previous.memberPage.items[0];change={moduleId,expectedBinding:null,nextOwner:{memberId:member.memberId,expectedRevision:member.revision},reason:'Test original stale basis'};name='cbim_module_owner_change_preview';args={change}}
  else if(turn===2){expect(previous.preview.change).toEqual(change);commit={change,expectedOwnershipCursor:previous.preview.ownershipCursor,expectedBasis:'0'.repeat(64)};args=commit}
  else if(turn===3){expect(previous).toMatchObject({status:'unknown',retryable:false,terminal:true,code:'OWNERSHIP_BASIS_STALE',reconcileTool:'cbim_receipt_inspect'});name=previous.reconcileTool;args=previous.reconcileArgs}
  else if(turn>6)throw Error('Failure circuit did not stop further model requests');
  res.writeHead(200,{'content-type':'text/event-stream'});
  const emit=(delta:unknown,finish_reason:string|null=null)=>res.write('data: '+JSON.stringify({id:'coord-'+turn,object:'chat.completion.chunk',created:1,model:'member-explicit-a',choices:[{index:0,delta,finish_reason}]})+'\n\n');
  emit({role:'assistant',tool_calls:[{index:0,id:'call-'+turn,type:'function',function:{name,arguments:JSON.stringify(args)}}]});emit({},'tool_calls');res.end('data: [DONE]\n\n');
 }catch(error){errors.push(String(error));if(!res.headersSent)res.writeHead(500);res.end(String(error))}});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const seed=await seedWorkspaceMembers(f.app,f.temp,`http://127.0.0.1:${(server.address() as any).port}/v1`);moduleId=seed.team.input.moduleId;await commitWorkspaceMember(f.app,seed.entry.id,seed.register());
  const before=await f.app.workspace(seed.entry.id).dispatchStore.read();
  const started=await f.app.dispatch('loop.chat',{id:seed.entry.id,message:'核实责任与原回执；过期依据不能提交',options:{permission:'execute',turnTimeoutMs:30000}});
  const inspect=()=>f.app.dispatch('loop.inspect',{id:seed.entry.id,taskId:started.taskId,runId:started.runId});
  await vi.waitFor(async()=>{if(errors.length)return;expect((await inspect()).status).not.toBe('running')},{timeout:30000,interval:50});
  const result=await inspect();expect(errors).toEqual([]);expect(result.status).toBe('failed');expect(requests).toHaveLength(7);
  expect(result.events.filter(event=>event.type==='tool.finished'&&event.data.name==='cbim_receipt_inspect')).toHaveLength(1);
  expect(result.events.find(event=>event.type==='engine.status'&&event.data.state==='blocked')?.data).toMatchObject({tool:'cbim_module_owner_change_commit',consecutive:3});
  const state=await f.app.workspace(seed.entry.id).dispatchStore.read();expect(state.ownershipChanges).toEqual(before.ownershipChanges);expect(state.scopes?.[0].goal?.plan).toBeUndefined();expect(state.graphs[0].tasks).toEqual([]);
 }finally{await f.app.shutdown();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await f.cleanup()}
},45000);
