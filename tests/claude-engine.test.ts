import {afterEach,expect,test} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {ClaudeCodeEngine,claudeEnvironment} from '../src/logic/execution/engines/claude/engine';
import type {EngineContext,EngineEvent} from '../src/logic/execution/rules/types';
import type {ResolvedEngineModel} from '../src/logic/engines';

const roots:string[]=[];
test('real Claude stop cancels an in-flight provider request and does not claim completion',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-cc-'));roots.push(root);const cwd=path.join(root,'project');await fs.mkdir(cwd);
  let received!:()=>void;const arrived=new Promise<void>(resolve=>{received=resolve});
  const server=http.createServer(async(req,res)=>{for await(const _part of req){}if(req.url?.includes('count_tokens')){res.end('{"input_tokens":1}');return}received()});await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const engine=new ClaudeCodeEngine({agentHome:path.join(root,'engine'),llm:model('http://127.0.0.1:'+(server.address() as any).port),prompt:'test',knowledge:{list:async()=>[],call:async()=>{throw Error('no tool')}},turnTimeoutMs:20000});
  try{
    await engine.start({task:{taskId:randomUUID(),workspaceId:'test',root:cwd,goal:'test',moduleIds:[],acceptance:[]},runId:randomUUID(),directory:path.join(root,'run'),emit:async()=>{},beforeTool:async()=>({allow:false})});
    const running=engine.run('Wait');await arrived;await engine.stop();expect(await running).toEqual({status:'cancelled'});
  }finally{await engine.close();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}
},30000);
afterEach(async()=>{for(const root of roots.splice(0)){if(path.dirname(root)!==path.resolve(os.tmpdir())||!path.basename(root).startsWith('cbim-cc-'))throw Error('unexpected test directory');await fs.rm(root,{recursive:true,force:true})}});
function model(baseUrl:string):ResolvedEngineModel{return {apiKey:'test-only-api-key',profile:{id:randomUUID(),engine:'claude-code',name:'test',api:'anthropic-messages',baseUrl,auth:'api-key',model:'vendor/qwen-custom-2026',contextWindow:200000,maxTokens:4096,reasoning:false}}}
test('Claude environment freezes the selected endpoint/model and removes inherited auth',()=>{
  const old=process.env.CLAUDE_CODE_OAUTH_TOKEN;process.env.CLAUDE_CODE_OAUTH_TOKEN='must-not-inherit';
  try{const env=claudeEnvironment('home',model('https://example.com/v1'));expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();expect(env.ANTHROPIC_BASE_URL).toBe('https://example.com');expect(env.ANTHROPIC_MODEL).toBe('vendor/qwen-custom-2026');expect(env.ANTHROPIC_API_KEY).toBe('test-only-api-key')}finally{if(old===undefined)delete process.env.CLAUDE_CODE_OAUTH_TOKEN;else process.env.CLAUDE_CODE_OAUTH_TOKEN=old}
});
test('real Claude Code passes a non-Claude model ID unchanged, streams and resumes its bound session',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-cc-'));roots.push(root);const home=path.join(root,'engine'),cwd=path.join(root,'project');await fs.mkdir(cwd);
  const requests:any[]=[];
  const server=http.createServer(async(req,res)=>{
    let raw='';for await(const part of req)raw+=part;const body=raw?JSON.parse(raw):{};
    if(req.url?.includes('count_tokens')){res.setHeader('content-type','application/json');res.end(JSON.stringify({input_tokens:100}));return}
    requests.push({path:req.url,body});
    res.writeHead(200,{'content-type':'text/event-stream'});
    const write=(event:any)=>res.write('event: '+event.type+'\ndata: '+JSON.stringify(event)+'\n\n');
    write({type:'message_start',message:{id:'msg_'+randomUUID(),type:'message',role:'assistant',model:'vendor/qwen-custom-2026',content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:100,output_tokens:0}}});
    write({type:'content_block_start',index:0,content_block:{type:'text',text:''}});
    write({type:'content_block_delta',index:0,delta:{type:'text_delta',text:'CBIM Claude OK'}});
    write({type:'content_block_stop',index:0});write({type:'message_delta',delta:{stop_reason:'end_turn',stop_sequence:null},usage:{output_tokens:5}});write({type:'message_stop'});res.end();
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const llm=model('http://127.0.0.1:'+(server.address() as any).port),events:EngineEvent[]=[],taskId=randomUUID();
  const context:EngineContext={task:{taskId,workspaceId:'test',root:cwd,mode:'chat',agentId:'cbim:main',goal:'test',moduleIds:[],acceptance:[]},runId:randomUUID(),directory:path.join(root,'run'),emit:async event=>{events.push(event)},beforeTool:async()=>({allow:false})};
  const options={agentHome:home,prompt:'Test the configured model.',knowledge:{list:async()=>[],call:async()=>{throw Error('no tool')}},llm,turnTimeoutMs:20000};
  let engine=new ClaudeCodeEngine(options);
  try{
    await engine.start(context);expect(await engine.run('Say OK')).toEqual({status:'completed'});await engine.close();
    const binding=events.find(e=>e.type==='session.bound')!.data;expect(binding.sessionId).toBe(taskId);expect(await fs.readFile(String(binding.sessionFile),'utf8')).toContain('CBIM Claude OK');
    expect(events.some(e=>e.type==='message'&&e.data.text==='CBIM Claude OK')).toBe(true);
    engine=new ClaudeCodeEngine(options);await engine.start({...context,runId:randomUUID(),nativeSessionId:taskId,sessionFile:String(binding.sessionFile)});expect(await engine.run('Continue')).toEqual({status:'completed'});
    expect(requests.every(r=>r.body.model==='vendor/qwen-custom-2026')).toBe(true);expect(requests.at(-1).body.messages.some((m:any)=>JSON.stringify(m).includes('Say OK'))).toBe(true);
    expect(JSON.stringify(events)).not.toContain(llm.apiKey);
  }finally{await engine.close();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}
},60000);
