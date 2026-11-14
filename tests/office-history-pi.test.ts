import {expect,it,vi} from 'vitest';
import http from 'node:http';
import {fixture} from './helpers';

/** 真实 Application/Pi/调度与工具装配；只以本机确定性服务替代在线模型。 */
it('主 Agent 在关联新话题中实际查询原办公室的旧用户输入，旧话题保持结束',async()=>{
 const f=await fixture(),requests:any[]=[],errors:unknown[]=[];let originalScope='';
 const server=http.createServer(async(req,res)=>{
  try{
   let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);requests.push(body);const turn=requests.length;
   res.writeHead(200,{'Content-Type':'text/event-stream'});
   const emit=(delta:unknown,finish_reason:string|null)=>res.write('data: '+JSON.stringify({id:'office-'+turn,object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta,finish_reason}]})+'\n\n');
   const tool=(input:unknown)=>{emit({role:'assistant',tool_calls:[{index:0,id:'office-read-'+turn,type:'function',function:{name:'cbim_office_history',arguments:JSON.stringify(input)}}]},null);emit({},'tool_calls')};
   if(turn===2)tool({action:'topics'});
   else if(turn===3)tool({action:'topic',scopeId:originalScope});
   else if(turn===4)tool({action:'content',scopeId:originalScope,refId:'goal'});
   else {emit({role:'assistant',content:turn===1?'第一项已回答。':'已读取原话题，按新要求回答。'},null);emit({},'stop')}
   res.end('data: [DONE]\n\n');
  }catch(error){errors.push(error);res.writeHead(500);res.end('fixture error')}
 });
 try{
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw Error('no port');
  const profiles=await f.app.models.save({profile:{name:'Office archive fixture',api:'openai-completions',baseUrl:`http://127.0.0.1:${address.port}/v1`,auth:'none',defaultModel:'office-test',models:[{id:'office-test',name:'Fixture',enabled:true,contextWindow:65536,maxTokens:1024,reasoning:false,pricing:{input:0,output:0,cacheRead:0,cacheWrite:0}}]}});
  const entry=await f.app.dispatch('add',{path:f.a}),options={profileId:profiles.selectedId!,model:'office-test',permission:'read' as const};
  const first=await f.app.dispatch('loop.chat',{id:entry.id,message:'OFFICE_ORIGINAL_USER_INPUT',options});
  const store=f.app.workspace(entry.id).dispatchStore;
  await vi.waitFor(async()=>{const scopes=(await store.read()).scopes??[];expect(scopes[0]?.status).toBe('closed');originalScope=scopes[0].scopeId},{timeout:15000});
  const queued=await f.app.dispatch('loop.enqueue',{id:entry.id,taskId:first.taskId,message:'请读取关联原话题再回答新的要求',followupOf:originalScope,options});
  await vi.waitFor(async()=>expect((await store.read()).scopes?.find(scope=>scope.scopeId===queued.id)?.status).toBe('closed'),{timeout:15000});
  expect(errors).toEqual([]);expect(requests).toHaveLength(5);
  expect(requests[1].tools.some((tool:any)=>tool.function?.name==='cbim_office_history')).toBe(true);
  const toolResults=requests[4].messages.filter((message:any)=>message.role==='tool');expect(JSON.stringify(toolResults)).toContain('OFFICE_ORIGINAL_USER_INPUT');
  const scopes=(await store.read()).scopes!;expect(scopes.find(scope=>scope.scopeId===queued.id)?.followupOf).toBe(originalScope);expect(scopes.find(scope=>scope.scopeId===originalScope)?.status).toBe('closed');
  const runs=await f.app.execution(entry.id).thread(first.taskId);expect(runs).toHaveLength(2);expect(runs[1].events.filter(event=>event.type==='tool.finished'&&event.data.name==='cbim_office_history').every(event=>!event.data.isError)).toBe(true);
 }finally{await f.cleanup();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}
});
