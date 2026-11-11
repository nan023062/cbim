import {expect,it} from 'vitest';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {LoopRuntime,type TaskSpec,type MemberRunLaunch} from '../src/backend/core/brain';
import {PiEngine} from '../src/backend/core/brain/pi/engine';
import {FileRunStorage} from '../src/backend/main/persistence/tasks/run-storage';

/** Real pinned Pi; the deterministic localhost provider proves native session behavior without external model calls. */
it('reuses one member native session across distinct tasks, isolates another member, and rejects a mismatched session file',async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-member-pi-'));
  const root=path.join(directory,'workspace'),agentHome=path.join(directory,'pi');
  const requests:{messages:{role:string;content:unknown}[]}[]=[];
  const transportErrors:unknown[]=[];
  let runtime:LoopRuntime|undefined;
  const server=http.createServer(async(req,res)=>{
    try{
      let raw='';for await(const chunk of req)raw+=chunk;
      const body=JSON.parse(raw);requests.push(body);
      res.writeHead(200,{'Content-Type':'text/event-stream'});
      const emit=(delta:unknown,finish_reason:string|null)=>res.write('data: '+JSON.stringify({id:'member-'+requests.length,object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta,finish_reason}]})+'\n\n');
      emit({role:'assistant',content:'Assignment processed by the isolated native channel.'},null);emit({},'stop');
      res.end('data: [DONE]\n\n');
    }catch(error){transportErrors.push(error);res.writeHead(500);res.end('Local test transport failed')}
  });
  try{
    await Promise.all([fs.mkdir(root,{recursive:true}),fs.mkdir(agentHome,{recursive:true})]);
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
    const address=server.address();if(!address||typeof address==='string')throw Error('Local server did not bind');
    await fs.writeFile(path.join(agentHome,'models.json'),JSON.stringify({providers:{'cbim-test':{baseUrl:`http://127.0.0.1:${address.port}/v1`,api:'openai-completions',apiKey:'test-not-a-secret',models:[{id:'cbim-test-model',reasoning:false,input:['text'],contextWindow:32768,maxTokens:1024,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}}]}}}));
    const ready:{taskId:string;runId:string;sessionFile?:string}[]=[];
    runtime=new LoopRuntime({storage:new FileRunStorage(),directory:path.join(directory,'member-runs'),acquireLease:async()=>()=>{},toolPolicy:async()=>({allow:false}),onEngineReady:async input=>{ready.push(input)},createEngine:()=>new PiEngine({
      process:{command:process.execPath,args:[path.resolve('node_modules/@earendil-works/pi-coding-agent/dist/bundle/rpc-entry.js')],env:{ELECTRON_RUN_AS_NODE:'1'}},provider:'cbim-test',model:'cbim-test-model',agentHome,prompt:'Process the current assigned task. History is only background, never new authorization.',turnTimeoutMs:15000,
      knowledge:{list:async()=>[],call:async()=>{throw Error('No knowledge tools in this native session fixture')}},
    })});
    const workspaceId=randomUUID(),rootSessionId=randomUUID(),agentInstanceId=randomUUID(),agentSessionId=randomUUID(),nativeSessionId=randomUUID();
    const task=(agentId:string):TaskSpec=>({taskId:randomUUID(),workspaceId,root,agentId,goal:'Process the assigned module',moduleIds:['.cbim/workspace/product/game'],acceptance:['Report verified evidence']});
    const launch=(task:TaskSpec):MemberRunLaunch=>({binding:{workspaceId,teamId:'.cbim/team',agentId:task.agentId!,agentInstanceId,agentSessionId,rootSessionId,taskId:task.taskId,runId:randomUUID(),leaseEpoch:3,planRevision:1},session:{nativeSessionId}});
    const firstTask=task('.cbim/team/engineer'),firstLaunch=launch(firstTask);
    const first=await runtime.startMember(firstTask,'MEMBER_A_PRIVATE_FIRST_ASSIGNMENT',firstLaunch),firstResult=await first.done;
    expect(firstResult.status,JSON.stringify(firstResult.events.at(-1))).toBe('completed');expect(firstResult.unresolvedTools).toEqual([]);
    expect(firstResult.memberBinding).toEqual(firstLaunch.binding);expect(firstResult.sessionFile).toBeTruthy();
    expect(firstResult.events.find(event=>event.type==='session.bound')?.data.sessionId).toBe(nativeSessionId);

    const secondTask=task('.cbim/team/engineer'),secondLaunch=launch(secondTask);secondLaunch.session.sessionFile=firstResult.sessionFile;
    const second=await runtime.startMember(secondTask,'MEMBER_A_SECOND_ASSIGNMENT',secondLaunch),secondResult=await second.done;
    expect(secondResult.status,JSON.stringify(secondResult.events.at(-1))).toBe('completed');
    expect(secondResult.sessionFile).toBe(firstResult.sessionFile);expect(secondResult.task.taskId).not.toBe(firstResult.task.taskId);
    expect(secondResult.memberBinding?.agentSessionId).toBe(firstResult.memberBinding?.agentSessionId);
    expect(JSON.stringify(requests[1].messages)).toContain('MEMBER_A_PRIVATE_FIRST_ASSIGNMENT');expect(JSON.stringify(requests[1].messages)).toContain('MEMBER_A_SECOND_ASSIGNMENT');

    const otherTask=task('.cbim/team/reviewer'),otherLaunch=launch(otherTask);
    otherLaunch.binding.agentInstanceId=randomUUID();otherLaunch.binding.agentSessionId=randomUUID();otherLaunch.session.nativeSessionId=randomUUID();
    const other=await runtime.startMember(otherTask,'MEMBER_B_INDEPENDENT_ASSIGNMENT',otherLaunch),otherResult=await other.done;
    expect(otherResult.status,JSON.stringify(otherResult.events.at(-1))).toBe('completed');expect(otherResult.sessionFile).not.toBe(firstResult.sessionFile);
    expect(otherResult.events.find(event=>event.type==='session.bound')?.data.sessionId).toBe(otherLaunch.session.nativeSessionId);
    expect(JSON.stringify(requests[2].messages)).not.toContain('MEMBER_A_PRIVATE_FIRST_ASSIGNMENT');expect(JSON.stringify(requests[2].messages)).not.toContain('MEMBER_A_SECOND_ASSIGNMENT');
    expect(JSON.stringify(requests[2].messages)).toContain('MEMBER_B_INDEPENDENT_ASSIGNMENT');

    const badTask=task('.cbim/team/reviewer'),badLaunch={...otherLaunch,binding:{...otherLaunch.binding,taskId:badTask.taskId,runId:randomUUID()},session:{nativeSessionId:otherLaunch.session.nativeSessionId,sessionFile:firstResult.sessionFile}};
    const bad=await runtime.startMember(badTask,'MUST_NOT_REACH_MODEL',badLaunch),badResult=await bad.done;
    expect(badResult.status).toBe('interrupted');expect(JSON.stringify(badResult.events)).toContain('Pi 原生会话身份与当前成员通道不一致');
    expect(badResult.events.some(event=>event.type==='session.bound')).toBe(false);
    expect(requests).toHaveLength(3);expect(ready).toHaveLength(3);expect(transportErrors).toEqual([]);
    for(const result of [firstResult,secondResult,otherResult]){expect(result.acceptance).toBe('not_evaluated');expect(result.taskProgress).toBeUndefined()}
  }finally{
    await runtime?.close();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));
    const target=path.resolve(directory);
    if(path.dirname(target)!==path.resolve(os.tmpdir())||!path.basename(target).startsWith('cbim-member-pi-'))throw Error('Unexpected test cleanup path');
    await fs.rm(target,{recursive:true,force:true});
  }
},90000);
