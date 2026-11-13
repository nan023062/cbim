import {expect,it} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {PiEngine} from '../src/backend/engines/pi/engine';
import type {EngineEvent} from '../src/backend/core/execution/types';

it.each(['progress','silent'] as const)('真实 Pi 与本地流式端点：%s，活跃跨过窗口/静默退出且只发一次请求',async mode=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-idle-')),cwd=path.join(root,'project'),directory=path.join(root,'run');
  await fs.mkdir(cwd);await fs.mkdir(directory);
  let requests=0;const intervals=new Set<ReturnType<typeof setInterval>>();
  const server=http.createServer(async(req,res)=>{
    for await(const _chunk of req){}requests++;
    res.writeHead(200,{'Content-Type':'text/event-stream'});res.flushHeaders();
    if(mode==='silent')return;
    let chunks=0;
    const send=(delta:unknown,finish_reason:string|null)=>res.write('data: '+JSON.stringify({id:'completion',object:'chat.completion.chunk',created:1,model:'test-model',choices:[{index:0,delta,finish_reason}]})+'\n\n');
    send({role:'assistant',content:'start '},null);
    const interval=setInterval(()=>{
      send({content:'progress '},null);
      if(++chunks===12){clearInterval(interval);intervals.delete(interval);send({},'stop');res.end('data: [DONE]\n\n')}
    },250);
    intervals.add(interval);res.on('close',()=>{clearInterval(interval);intervals.delete(interval)});
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const events:EngineEvent[]=[],engine=new PiEngine({process:{command:process.execPath,args:[path.resolve('node_modules/@earendil-works/pi-coding-agent/dist/bundle/rpc-entry.js')],env:{ELECTRON_RUN_AS_NODE:'1'}},provider:'test',model:'test-model',agentHome:path.join(root,'pi'),prompt:'Local deterministic timeout test.',turnTimeoutMs:1500,knowledge:{list:async()=>[],call:async()=>{throw Error('no tools')}},llm:{apiKey:'fixture-only',profile:{id:randomUUID(),name:'fixture',api:'openai-completions',baseUrl:'http://127.0.0.1:'+(server.address() as any).port+'/v1',auth:'api-key',model:'test-model',contextWindow:32768,maxTokens:1024,reasoning:false}}});
  try{
    await engine.start({task:{taskId:randomUUID(),workspaceId:'fixture',root:cwd,goal:'test',moduleIds:[],acceptance:[]},runId:randomUUID(),directory,emit:async event=>{events.push(event)},beforeTool:async()=>({allow:false})});
    const began=Date.now();
    if(mode==='progress'){
      expect(await engine.run('Stream')).toEqual({status:'completed'});expect(Date.now()-began).toBeGreaterThan(2800);
      expect(events.filter(event=>event.type==='message.delta').length).toBeGreaterThan(6);
    }else await expect(engine.run('Wait')).rejects.toThrow('1.5 秒无执行进展');
    expect(requests).toBe(1);
  }finally{
    await engine.close();for(const interval of intervals)clearInterval(interval);server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));
    if(path.dirname(root)!==path.resolve(os.tmpdir())||!path.basename(root).startsWith('cbim-idle-'))throw Error('unexpected fixture directory');
    await fs.rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});
  }
},20000);
