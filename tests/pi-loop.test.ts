import {it,expect} from 'vitest';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './helpers';
import {seedTeam} from './team-fixture';
import {LoopRuntime} from '../src/logic/execution/rules';
import {PiEngine} from '../src/backend/engines/pi/engine';
import {FileRunStorage} from '../src/backend/main/run-storage/run-storage';
import {guard} from '../src/backend/main/platform/tool-guard';
import {authorizeRunTool} from '../src/logic/tools/rules/policy/tool-policy';
import {nativeToolDescriptor} from '../src/logic/tools/rules/native-tools';
import {knowledgeTools} from '../src/backend/scheduler-engine/tools/knowledge-tools';
import {loopInstructions,prepareTeamTask} from '../src/backend/scheduler-engine/context/team-workflow';

/** Real pinned Pi kernel contract with real knowledge/policy services and a deterministic localhost model; not an Application business launch. */
it('rejects the old Application business entry while trusted Core Pi gates tools, settles, resumes, and stops its persisted session',async()=>{
  const f=await fixture();let requests=0,runtime:LoopRuntime|undefined;
  let hold=false,requestStarted:()=>void=()=>{};
  const transportErrors:unknown[]=[];
  const server=http.createServer(async(req,res)=>{
    try{
      let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);requests++;
      expect(body.model).toBe('cbim-test-model');
      if(hold){requestStarted();return}
      res.writeHead(200,{'Content-Type':'text/event-stream'});
      const emit=(delta:unknown,finish_reason:string|null)=>res.write('data: '+JSON.stringify({id:'completion-'+requests,object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta,finish_reason}]})+'\n\n');
      if(requests===1){
        expect(JSON.stringify(body.messages)).toContain('团队校验规则');
        expect(JSON.stringify(body.messages)).toContain('先理解目标，再验证并记录证据');
        expect(body.tools.some((t:{function:{name:string}})=>t.function.name==='cbim_workspace_identity')).toBe(true);
        emit({role:'assistant',tool_calls:[{index:0,id:'identity-call',type:'function',function:{name:'cbim_workspace_identity',arguments:'{}'}}]},null);emit({},'tool_calls');
      }else if(requests===2){
        emit({role:'assistant',tool_calls:[{index:0,id:'denied-read',type:'function',function:{name:'read',arguments:'{"path":".cbim/entry.md"}'}}]},null);emit({},'tool_calls');
      }else{emit({role:'assistant',content:'Verified workspace through CBIM internal tools.'},null);emit({},'stop')}
      res.end('data: [DONE]\n\n');
    }catch(error){transportErrors.push(error);res.writeHead(500);res.end('Local test transport failed')}
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const entry=await f.app.dispatch('add',{path:f.a}),workspace=f.app.workspace(entry.id);
    await expect(fs.access(path.join(f.app.paths.project(entry.id),'discovery.json'))).rejects.toThrow();
    await expect(fs.access(path.join(f.a,'.mcp.json'))).rejects.toThrow();
    const agentHome=path.join(f.app.paths.project(entry.id),'loop-engine','pi');
    await fs.mkdir(agentHome,{recursive:true});
    const address=server.address();if(!address||typeof address==='string')throw Error('Local test server did not bind');
    await fs.writeFile(path.join(agentHome,'models.json'),JSON.stringify({providers:{'cbim-test':{baseUrl:`http://127.0.0.1:${address.port}/v1`,api:'openai-completions',apiKey:'test-not-a-secret',models:[{id:'cbim-test-model',reasoning:false,input:['text'],contextWindow:32768,maxTokens:1024,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}}]}}}));
    const seeded=await seedTeam(workspace),options={provider:'cbim-test',model:'cbim-test-model',turnTimeoutMs:20000};
    await expect(f.app.dispatch('loop.start',{id:entry.id,task:seeded.input,options})).rejects.toMatchObject({code:'OWNER_DISPATCH_REQUIRED'});
    expect(requests).toBe(0);expect(await f.app.execution(entry.id).list()).toEqual([]);

    // Kernel/native compatibility coverage deliberately has no fabricated owner binding. Formal business admission is tested above and in owner-execution Pi tests.
    const task=await prepareTeamTask(workspace,seeded.input),service=knowledgeTools(workspace);
    runtime=new LoopRuntime({
      storage:new FileRunStorage(),directory:path.join(f.app.paths.project(entry.id),'loop-engine','tasks'),
      acquireLease:async candidate=>{workspace.assert();expect(candidate.workspaceId).toBe(entry.id);expect(candidate.root).toBe(f.a);return ()=>{}},
      describeTool:call=>{
        workspace.assert();if(call.name.startsWith('cbim_'))return service.describe(call.name,call.input);
        const descriptor=nativeToolDescriptor(call.name);if(!descriptor)throw Error('Unsupported kernel test tool');return descriptor;
      },
      toolPolicy:async(call,descriptor)=>{
        if(!descriptor)throw Error('Missing real tool descriptor');
        return authorizeRunTool(call,descriptor,{workspaceId:entry.id,permission:'read',guard:async native=>{
          const reason=guard({name:native.name==='find'?'Glob':native.name,input:native.input},f.a);return {allow:!reason,reason};
        }});
      },
      createEngine:()=>new PiEngine({
        process:{command:process.execPath,args:[path.resolve('node_modules/@earendil-works/pi-coding-agent/dist/bundle/rpc-entry.js')],env:{ELECTRON_RUN_AS_NODE:'1'}},
        ...options,agentHome,prompt:loopInstructions,
        knowledge:{list:async()=>service.list(),call:(name,args,signal)=>service.callFromRun(name,args,false,signal)},
      }),
    });
    const first=await runtime.start(task),result=await first.done;
    expect(result.status,JSON.stringify(result.events.at(-1))).toBe('completed');expect(result.acceptance).toBe('not_evaluated');
    expect(result.task.ownerBinding).toBeUndefined();
    expect(result.events.some(e=>e.type==='tool.allowed'&&e.data.name==='cbim_workspace_identity')).toBe(true);
    expect(result.events.some(e=>e.type==='tool.denied'&&e.data.id==='denied-read')).toBe(true);
    const identity=result.events.find(e=>e.type==='tool.finished'&&e.data.id==='identity-call');expect(JSON.stringify(identity)).toContain(task.workspaceId);
    expect(result.unresolvedTools).toEqual([]);
    if(!result.sessionFile)throw Error('Real Pi did not persist its native session');
    await fs.access(result.sessionFile);
    const nativeId=result.events.find(e=>e.type==='session.bound')?.data.sessionId;expect(typeof nativeId).toBe('string');expect(nativeId).toBeTruthy();
    const beforeDeniedResume=await fs.readFile(result.sessionFile);
    await expect(f.app.dispatch('loop.resume',{id:entry.id,taskId:task.taskId,runId:first.runId,message:'不能绕过正式派发',options})).rejects.toMatchObject({code:'OWNER_DISPATCH_REQUIRED'});
    expect(await fs.readFile(result.sessionFile)).toEqual(beforeDeniedResume);expect(requests).toBe(3);

    const second=await runtime.start(task,'仅总结已有结果，不重复操作。',{runId:first.runId}),resumed=await second.done;
    expect(resumed.status,JSON.stringify(resumed.events.at(-1))).toBe('completed');expect(resumed.sessionFile).toBe(result.sessionFile);
    expect(resumed.events.find(e=>e.type==='session.bound')?.data.sessionId).toBe(nativeId);expect(requests).toBe(4);
    hold=true;const received=new Promise<void>(resolve=>{requestStarted=resolve});
    const third=await runtime.start(task,'等待模型时测试中断。',{runId:second.runId});
    await received;await runtime.stop(task.taskId);
    expect((await third.done).status).toBe('cancelled');expect(requests).toBe(5);expect(transportErrors).toEqual([]);
  }finally{await runtime?.close();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await f.cleanup()}
},60000);
