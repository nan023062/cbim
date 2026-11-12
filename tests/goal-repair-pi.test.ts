import {expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {fixture} from './helpers';

it('真实命令检查失败后自动返工、修复文件并重测，原失败记录不改写',async()=>{
  const f=await fixture(),requests:unknown[]=[],errors:unknown[]=[];
  const command='node -e "const fs=require(\'fs\');if(fs.readFileSync(\'repair-target.txt\',\'utf8\')!==\'fixed\')process.exit(1);console.log(\'one test passed\')"';
  const server=http.createServer(async(req,res)=>{
    try{
      let raw='';for await(const part of req)raw+=part;const body=JSON.parse(raw),turn=requests.length;requests.push(body);
      res.writeHead(200,{'Content-Type':'text/event-stream'});
      const emit=(delta:unknown,finish_reason:string|null)=>res.write('data: '+JSON.stringify({id:'repair-'+turn,object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta,finish_reason}]})+'\n\n');
      const tool=(id:string,name:string,input:unknown)=>{emit({role:'assistant',tool_calls:[{index:0,id,type:'function',function:{name,arguments:JSON.stringify(input)}}]},null);emit({},'tool_calls')};
      if(turn===0)tool('plan','cbim_goal_plan',{expectedRevision:1,objective:'修复并验证文件',constraints:[],criteria:[{id:'test',text:'实际命令检查通过',kind:'evidence'}],assignments:[{agentId:'cbim:main',moduleIds:[],criterionIds:['test'],reason:'本地主会话直接修复'}],reason:'验证失败后需修复'});
      else if(turn===1)tool('failed-test','bash',{command});
      else if(turn===3)tool('fix','write',{path:'repair-target.txt',content:'fixed'});
      else if(turn===4)tool('passed-test','bash',{command});
      else if(turn===5)tool('review','cbim_goal_review',{expectedRevision:2,decision:'complete',checks:[{criterionId:'test',outcome:'satisfied',reason:'修复后真实命令通过',evidence:[{kind:'main-execution',toolCallIds:['passed-test']}]}],superseded:[],gaps:[],reason:'最终文件已复测'});
      else{emit({role:'assistant',content:turn===2?'本轮结束':'已修复并验证'},null);emit({},'stop')}
      res.end('data: [DONE]\n\n');
    }catch(error){errors.push(error);res.writeHead(500);res.end()}
  });
  try{
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw Error('no port');
    await f.app.models.save({profile:{name:'Repair fixture',api:'openai-completions',baseUrl:`http://127.0.0.1:${address.port}/v1`,auth:'none',defaultModel:'repair',models:[{id:'repair',name:'Repair',enabled:true,contextWindow:65536,maxTokens:1024,reasoning:false,pricing:{input:0,output:0,cacheRead:0,cacheWrite:0}}]}});
    const entry=await f.app.dispatch('add',{path:f.a});await fs.writeFile(path.join(f.a,'repair-target.txt'),'broken');
    const started=await f.app.dispatch('loop.chat',{id:entry.id,message:'修复文件并实际检查',options:{permission:'execute',turnTimeoutMs:15000}}) as {taskId:string};
    await vi.waitFor(async()=>{
      const history=await f.app.execution(entry.id).thread(started.taskId);expect(history).toHaveLength(2);expect(history[1].status).toBe('completed');
    },{timeout:30000,interval:50});
    const history=await f.app.execution(entry.id).thread(started.taskId),scopes=await f.app.memberDispatch(entry.id).automaticReturns.scopes();
    await vi.waitFor(async()=>expect(await f.app.memberDispatch(entry.id).goals.inspect({workspaceId:entry.id,rootSessionId:started.taskId},scopes.at(-1)!.scopeId)).toMatchObject({status:'closed',outcome:'completed'}));
    expect(history[0].toolReceipts?.find(item=>item.toolCallId==='failed-test')).toMatchObject({outcome:'failed'});
    expect(history[1].toolReceipts?.find(item=>item.toolCallId==='passed-test')).toMatchObject({outcome:'succeeded'});
    expect(history[1].source).toMatchObject({kind:'goal-repair',attempt:1,sourceRunId:history[0].runId});
    expect(await fs.readFile(path.join(f.a,'repair-target.txt'),'utf8')).toBe('fixed');expect(requests).toHaveLength(7);expect(errors).toEqual([]);
  }finally{await f.cleanup();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}
},60000);
