import {expect,it,vi} from 'vitest';
import http from 'node:http';
import {fixture} from './helpers';
import {seedWorkspaceMembers} from './workspace-member-fixture';
import {knowledgeContractResult} from './knowledge-contract-provider';

it('真实主 Pi 可见网页工具，内网和未配置搜索在实际服务拒绝且结果返回模型',async()=>{
 const f=await fixture(),errors:string[]=[],requests:any[]=[];
 const server=http.createServer(async(req,res)=>{try{
  let raw='';for await(const chunk of req)raw+=chunk;
  const body=JSON.parse(raw),turn=requests.length;requests.push(body);
  expect(body.tools.map((tool:any)=>tool.function.name)).toEqual(expect.arrayContaining(['cbim_web_fetch','cbim_web_search']));
  if(turn===1)expect(JSON.stringify(knowledgeContractResult(body,'web-0'))).toContain('WEB_SSRF');
  if(turn===2)expect(JSON.stringify(knowledgeContractResult(body,'web-1'))).toContain('WEB_SEARCH_CONFIG');
  if(turn>2)throw Error('不应自动重试网页请求');
  res.writeHead(200,{'content-type':'text/event-stream'});
  const emit=(delta:unknown,finish_reason:string|null=null)=>res.write('data: '+JSON.stringify({id:'web-'+turn,object:'chat.completion.chunk',created:1,model:'member-explicit-a',choices:[{index:0,delta,finish_reason}]})+'\n\n');
  if(turn<2){const name=turn?'cbim_web_search':'cbim_web_fetch',args=turn?{query:'建筑设计'}:{url:'http://127.0.0.1/'};emit({role:'assistant',tool_calls:[{index:0,id:'web-'+turn,type:'function',function:{name,arguments:JSON.stringify(args)}}]});emit({},'tool_calls')}
  else{emit({role:'assistant',content:'内网地址被拒绝；请在设置中配置 Brave 后再使用搜索。'});emit({},'stop')}
  res.end('data: [DONE]\n\n');
 }catch(error){errors.push(String(error));res.writeHead(500).end(String(error))}});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const seed=await seedWorkspaceMembers(f.app,f.temp,`http://127.0.0.1:${(server.address() as any).port}/v1`);
  const started=await f.app.dispatch('loop.chat',{id:seed.entry.id,message:'核实网页工具边界',options:{permission:'read',turnTimeoutMs:30000}});
  const inspect=()=>f.app.dispatch('loop.inspect',{id:seed.entry.id,taskId:started.taskId,runId:started.runId});
  await vi.waitFor(async()=>expect((await inspect()).status).not.toBe('running'),{timeout:30000,interval:50});
  expect(errors).toEqual([]);expect(requests).toHaveLength(3);expect((await inspect()).events.filter(event=>event.type==='tool.finished'&&String(event.data.name).startsWith('cbim_web_'))).toHaveLength(2);
 }finally{await f.app.shutdown();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await f.cleanup()}
},45000);
