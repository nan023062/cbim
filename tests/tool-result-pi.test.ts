import {expect,it} from 'vitest';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {LoopRuntime,type TaskSpec} from '../src/logic/execution/rules';
import {PiEngine} from '../src/logic/execution/engines/pi/engine';
import {FileRunStorage} from '../src/backend/main/run-storage/run-storage';

/** Real pinned Pi subprocess; the local SSE provider never sends a request to an external model. */
it('rejects malformed internal tool output before Pi persists it and can resume the same session',async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-pi-tool-result-'));
  const root=path.join(directory,'workspace'),agentHome=path.join(directory,'pi');
  const requests:{model:string;messages:{role:string;tool_call_id?:string;content:unknown}[]}[]=[];
  const transportErrors:unknown[]=[];
  let toolCalls=0,runtime:LoopRuntime|undefined;
  const server=http.createServer(async(req,res)=>{
    try{
      let raw='';for await(const chunk of req)raw+=chunk;
      const body=JSON.parse(raw);requests.push(body);
      res.writeHead(200,{'Content-Type':'text/event-stream'});
      const emit=(delta:unknown,finish_reason:string|null)=>res.write('data: '+JSON.stringify({
        id:'completion-'+requests.length,object:'chat.completion.chunk',created:1,model:body.model,
        choices:[{index:0,delta,finish_reason}],
      })+'\n\n');
      if(requests.length===1){
        emit({role:'assistant',tool_calls:[{index:0,id:'invalid-result-call',type:'function',function:{name:'cbim_invalid_result',arguments:'{}'}}]},null);
        emit({},'tool_calls');
      }else{
        emit({role:'assistant',content:requests.length===2?'Tool error handled; the turn completed.':'The original session resumed successfully.'},null);
        emit({},'stop');
      }
      res.end('data: [DONE]\n\n');
    }catch(error){transportErrors.push(error);res.writeHead(500);res.end('Local test transport failed')}
  });
  try{
    await Promise.all([fs.mkdir(root,{recursive:true}),fs.mkdir(agentHome,{recursive:true})]);
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
    const address=server.address();if(!address||typeof address==='string')throw Error('Local test server did not bind');
    await fs.writeFile(path.join(agentHome,'models.json'),JSON.stringify({providers:{'cbim-test':{
      baseUrl:`http://127.0.0.1:${address.port}/v1`,api:'openai-completions',apiKey:'test-not-a-secret',
      models:[{id:'cbim-test-model',reasoning:false,input:['text'],contextWindow:32768,maxTokens:1024,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}}],
    }}}));
    runtime=new LoopRuntime({
      storage:new FileRunStorage(),directory:path.join(directory,'runs'),acquireLease:async()=>()=>{},
      toolPolicy:async call=>({allow:call.name==='cbim_invalid_result',effects:['read']}),
      createEngine:()=>new PiEngine({
        process:{command:process.execPath,args:[path.resolve('node_modules/@earendil-works/pi-coding-agent/dist/bundle/rpc-entry.js')],env:{ELECTRON_RUN_AS_NODE:'1'}},
        provider:'cbim-test',model:'cbim-test-model',agentHome,prompt:'Exercise the internal tool result boundary.',turnTimeoutMs:15000,
        knowledge:{
          list:async()=>[{name:'cbim_invalid_result',description:'Regression fixture returning a malformed text block.',inputSchema:{type:'object',properties:{},additionalProperties:false}}],
          call:async()=>{toolCalls++;return {content:[{type:'text'}]}},
        },
      }),
    });
    const task:TaskSpec={taskId:randomUUID(),workspaceId:randomUUID(),root,mode:'chat',goal:'Call the regression fixture and continue after its error.',moduleIds:[],acceptance:[]};
    const first=await runtime.start(task),result=await first.done;
    expect(result.status,JSON.stringify(result.events.at(-1))).toBe('completed');
    expect(result.unresolvedTools).toEqual([]);
    const finished=result.events.filter(event=>event.type==='tool.finished'&&event.data.id==='invalid-result-call');
    expect(finished).toHaveLength(1);
    expect(finished[0].data).toMatchObject({isError:true,result:{content:[{type:'text',text:expect.stringContaining('TOOL_RESULT_INVALID')}]}});
    expect(result.toolReceipts).toMatchObject([{toolCallId:'invalid-result-call',outcome:'failed'}]);
    expect(JSON.stringify(result.events)).toContain('Tool error handled; the turn completed.');
    expect(requests).toHaveLength(2);
    expect(requests[1].messages).toContainEqual(expect.objectContaining({role:'tool',tool_call_id:'invalid-result-call',content:expect.stringContaining('TOOL_RESULT_INVALID')}));

    // Check the native history, not just the UI journal: malformed tool text caused the next prompt to crash in Pi's token estimator.
    expect(result.sessionFile).toBeTruthy();
    const entries=(await fs.readFile(result.sessionFile!,'utf8')).trim().split('\n').map(line=>JSON.parse(line));
    const persisted=entries.find(entry=>entry.message?.role==='toolResult'&&entry.message.toolCallId==='invalid-result-call');
    expect(persisted?.message).toMatchObject({isError:true,content:[{type:'text',text:expect.stringContaining('TOOL_RESULT_INVALID')}]});
    for(const entry of entries){
      if(!Array.isArray(entry.message?.content))continue;
      for(const block of entry.message.content)if(block.type==='text')expect(typeof block.text).toBe('string');
    }

    const next=await runtime.start(task,'Continue the original session without calling the fixture again.',{runId:first.runId});
    const resumed=await next.done;
    expect(resumed.status,JSON.stringify(resumed.events.at(-1))).toBe('completed');
    expect(resumed.sessionFile).toBe(result.sessionFile);
    expect(resumed.unresolvedTools).toEqual([]);
    expect(JSON.stringify(resumed.events)).toContain('The original session resumed successfully.');
    expect(requests).toHaveLength(3);
    expect(requests[2].messages).toContainEqual(expect.objectContaining({role:'tool',content:expect.stringContaining('TOOL_RESULT_INVALID')}));
    expect(toolCalls).toBe(1);
    expect(transportErrors).toEqual([]);
  }finally{
    await runtime?.close();server.closeAllConnections();
    await new Promise<void>(resolve=>server.close(()=>resolve()));
    const target=path.resolve(directory);
    if(path.dirname(target)!==path.resolve(os.tmpdir())||!path.basename(target).startsWith('cbim-pi-tool-result-'))throw Error('Refusing to remove paths outside this test directory');
    await fs.rm(target,{recursive:true,force:true});
  }
},60000);
