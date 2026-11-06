import {test,expect} from 'vitest';
import {authorizeRunTool} from '../src/backend/core/policy/tool-policy';
import {knowledgeTools} from '../src/backend/scheduler-engine/tools/knowledge-tools';
import {fixture} from './helpers';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {randomUUID} from 'node:crypto';

test('read mode denies both write channels, including forged approvals and shell effects',async()=>{
  let approvals=0;
  for(const effect of ['business-write','knowledge-write','command'] as const){
    const result=await authorizeRunTool({id:'call',name:'write',input:{approved:true,permission:'execute'}},{effects:[effect],native:effect!=='knowledge-write'},{workspaceId:'workspace',permission:'read',guard:async()=>({allow:true}),approve:async()=>{approvals++;return {allow:true}}});
    expect(result.allow).toBe(false);expect(result.effects).toEqual([effect]);
  }
  expect(approvals).toBe(0);
});

test('real Pi routes knowledge commit through read, ask and execute modes and persists receipts',async()=>{
  const f=await fixture();let turn=0,args:Record<string,unknown>={};
  const server=http.createServer(async(req,res)=>{
    for await(const _chunk of req){};
    res.writeHead(200,{'Content-Type':'text/event-stream'});
    const emit=(delta:unknown,finish_reason:string|null)=>res.write('data: '+JSON.stringify({id:'unified-'+turn,object:'chat.completion.chunk',created:1,model:'policy-model',choices:[{index:0,delta,finish_reason}]})+'\n\n');
    if(turn++===0){emit({role:'assistant',tool_calls:[{index:0,id:'knowledge-write',type:'function',function:{name:'cbim_knowledge_commit',arguments:JSON.stringify(args)}}]},null);emit({},'tool_calls')}
    else{emit({role:'assistant',content:'操作结果已返回。'},null);emit({},'stop')}
    res.end('data: [DONE]\n\n');
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const entry=await f.app.dispatch('add',{path:f.a}),ws=f.app.workspace(entry.id),manager=f.app.execution(entry.id);
    const home=path.join(f.app.paths.project(entry.id),'loop-engine','pi');await fs.mkdir(home,{recursive:true});
    await fs.writeFile(path.join(home,'models.json'),JSON.stringify({providers:{'policy-provider':{baseUrl:`http://127.0.0.1:${(server.address() as any).port}/v1`,api:'openai-completions',apiKey:'test-only',models:[{id:'policy-model',reasoning:false,input:['text'],contextWindow:32768,maxTokens:1024,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}}]}}}));
    for(const permission of ['read','ask','execute'] as const){
      turn=0;
      const snap=await ws.snapshot();args={workspaceId:entry.id,instanceId:ws.instanceId,revision:snap.revision,requestId:randomUUID(),changes:[]};
      const run=await manager.chat('验证统一工具权限',{provider:'policy-provider',model:'policy-model',permission,allowNativeExecution:permission!=='read',turnTimeoutMs:20000});
      if(permission==='ask'){
        await expect.poll(()=>manager.pendingApprovals(run.taskId).length,{timeout:10000}).toBe(1);
        const approval=manager.pendingApprovals(run.taskId)[0];expect(approval.name).toBe('cbim_knowledge_commit');manager.answerApproval(run.taskId,approval.id,true);
      }
      await expect.poll(async()=>(await manager.inspect(run.taskId,run.runId)).status,{timeout:20000}).not.toBe('running');
      const result=await manager.inspect(run.taskId,run.runId);
      expect(result.status,JSON.stringify(result.events.at(-1))).toBe('completed');
      expect(result.toolReceipts,JSON.stringify(result.events.filter(e=>e.type.startsWith('tool.')))).toMatchObject([{toolCallId:'knowledge-write',outcome:permission==='read'?'denied':'succeeded',workspaceId:entry.id,runId:run.runId,effects:['knowledge-write']}]);
    }
  }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await f.cleanup()}
},60000);
test('ask uses the same approval for knowledge and files; platform denials cannot be bypassed',async()=>{
  let approvals=0;const context={workspaceId:'workspace',permission:'ask' as const,guard:async()=>({allow:true}),approve:async()=>{approvals++;return {allow:true}}};
  for(const effect of ['business-write','knowledge-write'] as const)expect((await authorizeRunTool({id:effect,name:'tool',input:{}},{effects:[effect],native:effect==='business-write'},context)).allow).toBe(true);
  expect(approvals).toBe(2);
  expect((await authorizeRunTool({id:'denied',name:'bash',input:{}},{effects:['command'],native:true},{...context,guard:async()=>({allow:false,reason:'outside'})})).allow).toBe(false);
  expect(approvals).toBe(2);
});
test('internal per-call knowledge permission cannot skip identity or revision and is not retained by the next call',async()=>{
  const f=await fixture();try{
    const entry=await f.app.dispatch('add',{path:f.a}),ws=f.app.workspace(entry.id),tools=knowledgeTools(ws),snap=await ws.snapshot();
    const args={workspaceId:entry.id,instanceId:ws.instanceId,revision:snap.revision,requestId:'unified-test',changes:[],approved:true};
    await expect(tools.callFromRun('cbim_knowledge_commit',args,false)).rejects.toThrow('知识写入权限');
    await expect(tools.callFromRun('cbim_knowledge_refresh',args,false)).rejects.toThrow('知识写入权限');
    await expect(tools.callFromRun('cbim_knowledge_commit',{...args,instanceId:'forged'},true)).rejects.toThrow();
    await expect(tools.callFromRun('cbim_knowledge_commit',{...args,revision:'outdated'},true)).rejects.toThrow();
    const value=await tools.callFromRun('cbim_knowledge_commit',args,true);
    expect(JSON.parse(value.content[0].text)).toMatchObject({state:'committed',workspaceId:entry.id});
    await expect(tools.callFromRun('cbim_knowledge_commit',args,false)).rejects.toThrow('知识写入权限');
    for(const tool of tools.list()){expect(tool.version).toBe(1);expect(tool.effects?.length).toBeGreaterThan(0)}
  }finally{await f.cleanup()}
});
