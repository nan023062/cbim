import {expect,it,vi} from 'vitest';
import Ajv from 'ajv';
import http from 'node:http';
import {fixture} from './helpers';
import {seedWorkspaceMembers} from './workspace-member-fixture';
import {knowledgeContractResult} from './knowledge-contract-provider';

it('真实 Pi 统一快照和原回执可达，版本冲突不给重试许可，连续三次失败熔断',async()=>{
 const f=await fixture(),errors:string[]=[],requests:any[]=[];
 const plan={expectedRevision:2,objective:'只核实当前版本',constraints:[],criteria:[{id:'check',text:'读取事实',kind:'evidence'}],assignments:[{agentId:'cbim:main',moduleIds:['cbim:project'],criterionIds:['check'],reason:'主会话直接核实'}],reason:'测试过期版本'};
 const server=http.createServer(async(req,res)=>{try{
  let raw='';for await(const chunk of req)raw+=chunk;
  const body=JSON.parse(raw),turn=requests.length;requests.push(body);
  expect(body.tools.map((tool:any)=>tool.function.name)).toEqual(expect.arrayContaining(['cbim_state_inspect','cbim_receipt_inspect']));
  // 校验真实 Pi 发给供应商的组合目录，避免只跑工具调用却遗漏发送前的 Schema 400。
  if(turn===0)for(const tool of body.tools.filter((item:any)=>['cbim_state_inspect','cbim_receipt_inspect'].includes(item.function.name)))new Ajv({strict:false,validateFormats:false}).compile(tool.function.parameters);
  const previous=turn?knowledgeContractResult(body,'call-'+(turn-1)):undefined;
  let name='cbim_goal_plan',args:unknown=plan;
  if(turn===0){name='cbim_state_inspect';args={target:'state',input:{}}}
  else if(turn===1){expect(previous.versions).toMatchObject({goalRevision:1,planRevision:null,tasks:[]})}
  else if(turn===2){
   expect(previous).toMatchObject({status:'unknown',retryable:false,terminal:true,code:'GOAL_REVISION_CONFLICT',reconcileTool:'cbim_receipt_inspect'});
   name=previous.reconcileTool;args=previous.reconcileArgs;
  }else if(turn>5)throw Error('熔断后仍请求模型');
  res.writeHead(200,{'content-type':'text/event-stream'});
  const emit=(delta:unknown,finish_reason:string|null=null)=>res.write('data: '+JSON.stringify({id:'coord-'+turn,object:'chat.completion.chunk',created:1,model:'member-explicit-a',choices:[{index:0,delta,finish_reason}]})+'\n\n');
  emit({role:'assistant',tool_calls:[{index:0,id:'call-'+turn,type:'function',function:{name,arguments:JSON.stringify(args)}}]});emit({},'tool_calls');res.end('data: [DONE]\n\n');
 }catch(error){errors.push(String(error));res.writeHead(500).end(String(error))}});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const seed=await seedWorkspaceMembers(f.app,f.temp,`http://127.0.0.1:${(server.address() as any).port}/v1`);
  const started=await f.app.dispatch('loop.chat',{id:seed.entry.id,message:'核实状态并处理版本冲突',options:{permission:'read',turnTimeoutMs:30000}});
  const inspect=()=>f.app.dispatch('loop.inspect',{id:seed.entry.id,taskId:started.taskId,runId:started.runId});
  await vi.waitFor(async()=>expect((await inspect()).status).not.toBe('running'),{timeout:30000,interval:50});
  const result=await inspect();expect(errors).toEqual([]);expect(result.status).toBe('failed');expect(requests).toHaveLength(6);
  expect(result.events.filter(event=>event.type==='tool.finished'&&event.data.name==='cbim_receipt_inspect')).toHaveLength(1);
  expect(result.events.find(event=>event.type==='engine.status'&&event.data.state==='blocked')?.data).toMatchObject({tool:'cbim_goal_plan',consecutive:3});
  const state=await f.app.workspace(seed.entry.id).dispatchStore.read();expect(state.scopes?.[0].goal?.plan).toBeUndefined();expect(state.graphs[0].tasks).toEqual([]);
 }finally{await f.app.shutdown();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await f.cleanup()}
},45000);
