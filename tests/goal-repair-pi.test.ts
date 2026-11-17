import {expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {fixture} from './helpers';
import {mainToolValue} from './main-tool-contract-provider';
import {Application} from '../src/bridge/server/application';
import {Paths} from '../src/logic/workspace/service/paths';

it('主 Agent 在原调用循环内读取失败、修复并重测，不创建旧目标返工轮次',async()=>{
  const f=await fixture(),requests:unknown[]=[],errors:unknown[]=[];let app=f.app;
  const command='node -e "const fs=require(\'fs\');if(fs.readFileSync(\'repair-target.txt\',\'utf8\')!==\'fixed\')process.exit(1);console.log(\'one test passed\')"';
  const server=http.createServer(async(req,res)=>{
    try{
      let raw='';for await(const part of req)raw+=part;const body=JSON.parse(raw),turn=requests.length;requests.push(body);
      res.writeHead(200,{'Content-Type':'text/event-stream'});
      const emit=(delta:unknown,finish_reason:string|null)=>res.write('data: '+JSON.stringify({id:'repair-'+turn,object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta,finish_reason}]})+'\n\n');
      const tool=(id:string,name:string,input:unknown)=>{emit({role:'assistant',tool_calls:[{index:0,id,type:'function',function:{name,arguments:JSON.stringify(input)}}]},null);emit({},'tool_calls')};
      expect(body.tools.some((t:{function:{name:string}})=>t.function.name==='cbim_goal_plan')).toBe(false);
      if(turn===0)tool('failed-test','bash',{command});
      else if(turn===1){expect(JSON.stringify(mainToolValue(body,'failed-test'))).toMatch(/1|exit|non-zero/i);tool('fix','write',{path:'repair-target.txt',content:'fixed'})}
      else if(turn===2)tool('passed-test','bash',{command});
      else if(turn===3){expect(JSON.stringify(mainToolValue(body,'passed-test'))).toContain('one test passed');emit({role:'assistant',content:'已按原指令修复文件，并通过实际命令检查。'},null);emit({},'stop')}
      else throw Error('Unexpected extra repair run '+turn);
      res.end('data: [DONE]\n\n');
    }catch(error){errors.push(error);res.writeHead(500);res.end()}
  });
  try{
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw Error('no port');
    await app.models.Save({profile:{name:'Repair fixture',api:'openai-completions',baseUrl:`http://127.0.0.1:${address.port}/v1`,auth:'none',defaultModel:'repair',models:[{id:'repair',name:'Repair',enabled:true,contextWindow:65536,maxTokens:1024,reasoning:false,pricing:{input:0,output:0,cacheRead:0,cacheWrite:0}}]}});
    const entry=await app.Dispatch('add',{path:f.a});await fs.writeFile(path.join(f.a,'repair-target.txt'),'broken');
    const started=await app.Dispatch('loop.chat',{id:entry.id,message:'修复文件并实际检查',options:{permission:'execute',turnTimeoutMs:15000}}) as {taskId:string};
    await vi.waitFor(async()=>{
      expect(errors).toEqual([]);const state=await app.Workspace(entry.id).dispatchStore.Read();
      expect(state.scopes?.[0]).toMatchObject({status:'closed',outcome:'completed'});expect(app.runtime.Snapshot().pressure.activeRuns).toBe(0);
    },{timeout:30000,interval:50});
    const history=await app.Execution(entry.id).Thread(started.taskId),state=await app.Workspace(entry.id).dispatchStore.Read();
    expect(history).toHaveLength(1);expect(history[0].status).toBe('completed');
    expect(history[0].toolReceipts?.find(item=>item.toolCallId==='failed-test')).toMatchObject({outcome:'failed'});
    expect(history[0].toolReceipts?.find(item=>item.toolCallId==='passed-test')).toMatchObject({outcome:'succeeded'});
    expect(history[0].source).not.toMatchObject({kind:'goal-repair'});
    expect(state.graphs[0].tasks).toEqual([]);expect(state.scopes?.[0].goal?.review).toBeUndefined();
    expect(await fs.readFile(path.join(f.a,'repair-target.txt'),'utf8')).toBe('fixed');expect(requests).toHaveLength(4);
    const canonicalPath=path.join(f.user,entry.id,'loop-engine/tasks',started.taskId,history[0].runId,'events.jsonl');
    const canonical=await fs.readFile(canonicalPath),native=await fs.readFile(history[0].sessionFile!);
    await app.Shutdown();app=new Application(new Paths(f.user,path.resolve('.')));await app.Init();
    expect(await app.Execution(entry.id).Thread(started.taskId)).toEqual(history);expect(await app.Workspace(entry.id).dispatchStore.Read()).toEqual(state);
    expect(await fs.readFile(canonicalPath)).toEqual(canonical);expect(await fs.readFile(history[0].sessionFile!)).toEqual(native);expect(requests).toHaveLength(4);
  }finally{await app.Shutdown();await f.cleanup();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}
},60000);
