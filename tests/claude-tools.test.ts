import {expect,test} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {ClaudeCodeEngine} from '../src/backend/engines/claude/engine';
import type {EngineEvent,ToolCall} from '../src/backend/core/execution/types';
import type {EngineToolsPort} from '../src/backend/core/execution/engine-tools';
import type {ResolvedLlm} from '../src/logic/models';
import {requestBudgetFixture} from './model-request-budget-fixture';
import Ajv from 'ajv';

function reply(res:http.ServerResponse,call?:{id:string;name:string;input:unknown}){
  res.writeHead(200,{'content-type':'text/event-stream'});const send=(value:any)=>res.write('event: '+value.type+'\ndata: '+JSON.stringify(value)+'\n\n');
  send({type:'message_start',message:{id:'msg_'+randomUUID(),type:'message',role:'assistant',content:[],model:'claude-test',stop_reason:null,stop_sequence:null,usage:{input_tokens:100,output_tokens:0}}});
  send({type:'content_block_start',index:0,content_block:call?{type:'tool_use',id:call.id,name:call.name,input:{}}:{type:'text',text:''}});
  send({type:'content_block_delta',index:0,delta:call?{type:'input_json_delta',partial_json:JSON.stringify(call.input)}:{type:'text_delta',text:'Finished'}});
  send({type:'content_block_stop',index:0});send({type:'message_delta',delta:{stop_reason:call?'tool_use':'end_turn',stop_sequence:null},usage:{output_tokens:20}});send({type:'message_stop'});res.end();
}
async function fixture(kind:'internal'|'read'|'write'|'bash',allow:boolean|'throw',settlement?:'fail'|'success'){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-cc-tools-')),cwd=path.join(root,'project');await fs.mkdir(cwd);await fs.writeFile(path.join(cwd,'sample.txt'),'sample content');
  const id='tool_'+randomUUID(),input=kind==='internal'?{value:'exact-input'}:kind==='bash'?{command:'echo cbim-claude-bash-ok'}:{file_path:path.join(cwd,kind==='read'?'sample.txt':'denied.txt'),...(kind==='write'?{content:'test output'}:{})};
  const name=kind==='internal'?'mcp__cbim__cbim_test_read':kind==='read'?'Read':kind==='bash'?'Bash':'Write';
  const requests:any[]=[],calls:ToolCall[]=[],events:EngineEvent[]=[],invocations:any[]=[];
  const server=http.createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;const body=raw?JSON.parse(raw):{};if(req.url?.includes('count_tokens')){res.setHeader('content-type','application/json');res.end('{"input_tokens":100}');return}requests.push(body);reply(res,requests.length===1?{id,name,input}:undefined)});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const llm:ResolvedLlm={apiKey:'private-test-key',profile:{id:randomUUID(),engine:'claude-code',name:'test',api:'anthropic-messages',baseUrl:'http://127.0.0.1:'+(server.address() as any).port,auth:'api-key',model:'claude-test',contextWindow:200000,maxTokens:4096,reasoning:false}};
  const knowledge:EngineToolsPort={list:async()=>[{name:'cbim_test_read',description:'Read test data',inputSchema:{anyOf:[{type:'object',properties:{value:{type:'string'}},required:['value'],additionalProperties:false},{type:'object',properties:{value:{$ref:'#/anyOf/0/properties/value'},preview:{type:'boolean'}},required:['value','preview'],additionalProperties:false}]}}],call:async(name,args,signal,toolCallId)=>{signal.throwIfAborted();invocations.push({name,args,id:toolCallId});return {content:[{type:'text',text:'tool-result'}]}}};
  const budget=settlement?await requestBudgetFixture({tokens:1000000},llm):undefined;let callsBeforeSettlement:number|undefined;
  const engine=new ClaudeCodeEngine({agentHome:path.join(root,'claude'),llm,prompt:'Use the provided tool.',knowledge,allowNativeExecution:true,turnTimeoutMs:20000,
    requestBudget:async()=>budget?{model:budget.port.model,reserve:async input=>{const ticket=await budget.port.reserve(input);return {...ticket,report:async(usage:Parameters<typeof ticket.report>[0])=>{await new Promise(resolve=>setTimeout(resolve,300));callsBeforeSettlement??=calls.length;if(settlement==='fail')throw Error('test settlement unavailable');await ticket.report(usage)}}}}:undefined});
  try{
    await engine.start({task:{taskId:randomUUID(),workspaceId:'test',root:cwd,mode:'chat',agentId:'cbim:main',goal:'tools',moduleIds:[],acceptance:[]},directory:path.join(root,'run'),runId:randomUUID(),emit:async event=>{events.push(event)},beforeTool:async call=>{calls.push(call);if(allow==='throw')throw Error('gate storage failure');return {allow,reason:allow?undefined:'CBIM test denial'}}});
    const result=await engine.run('Use the tool once.').catch(error=>{if(settlement!=='fail')throw error;return {status:'failed' as const,error:String(error)}});
    return {result,calls,events,invocations,id,input,requests,callsBeforeSettlement,budget:budget?await budget.service.report(budget.query):undefined,written:await fs.access(path.join(cwd,'denied.txt')).then(()=>true,()=>false)};
  }finally{await engine.close();await budget?.cleanup();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));if(path.dirname(root)!==path.resolve(os.tmpdir())||!path.basename(root).startsWith('cbim-cc-tools-'))throw Error('unexpected cleanup');await fs.rm(root,{recursive:true,force:true,maxRetries:8,retryDelay:150})}
}
test('real Claude internal tool receives its original ID only after CBIM authorization',async()=>{
  const f=await fixture('internal',true);expect(f.result).toEqual({status:'completed'});expect(f.calls).toEqual([{id:f.id,name:'cbim_test_read',input:f.input}]);
  expect(f.invocations).toEqual([{id:f.id,name:'cbim_test_read',args:f.input}]);expect(f.events.filter(e=>e.type==='tool.finished')).toHaveLength(1);expect(f.events.find(e=>e.type==='tool.finished')?.data).toMatchObject({id:f.id,isError:false});
  expect(f.requests.every(r=>r.model==='claude-test'&&r.max_tokens<=4096)).toBe(true);
  const wire=f.requests[0].tools.find((tool:any)=>tool.name==='mcp__cbim__cbim_test_read');
  expect(wire).toBeDefined();
  const validate=new Ajv({strict:false}).compile(wire.input_schema);
  expect(validate({value:'exact-input'})).toBe(true);
  expect(validate({value:42})).toBe(false);
},45000);
test('real Claude internal denied tool does not reach the port',async()=>{const f=await fixture('internal',false);expect(f.calls).toHaveLength(1);expect(f.invocations).toEqual([]);expect(f.events.some(e=>e.type==='tool.started')).toBe(false)},45000);
test('real Claude Read records canonical read input and one finished receipt',async()=>{const f=await fixture('read',true);expect(f.result).toEqual({status:'completed'});expect(f.calls[0]).toMatchObject({id:f.id,name:'read',input:{path:(f.input as any).file_path}});expect(f.events.filter(e=>e.type==='tool.finished')).toHaveLength(1)},45000);
test('real Claude Write cannot bypass CBIM denial',async()=>{const f=await fixture('write',false);expect(f.calls[0]).toMatchObject({name:'write'});expect(f.written).toBe(false);expect(f.events.some(e=>e.type==='tool.started')).toBe(false)},45000);
test('real Claude approved Write creates the file and records a successful receipt',async()=>{const f=await fixture('write',true);expect(f.written).toBe(true);expect(f.events.find(e=>e.type==='tool.finished')?.data).toMatchObject({id:f.id,name:'write',isError:false})},45000);
test('real Claude approved Bash executes through the canonical command gate',async()=>{const f=await fixture('bash',true);expect(f.result).toEqual({status:'completed'});expect(f.calls[0]).toMatchObject({id:f.id,name:'bash',input:{command:'echo cbim-claude-bash-ok'}});const receipt=f.events.find(e=>e.type==='tool.finished')?.data;expect(receipt).toMatchObject({id:f.id,name:'bash',isError:false});expect(JSON.stringify(receipt?.result)).toContain('cbim-claude-bash-ok')},45000);
test('real Claude hook failure blocks Write instead of silently allowing it',async()=>{const f=await fixture('write','throw');expect(f.calls).toHaveLength(1);expect(f.written).toBe(false);expect(f.events.some(e=>e.type==='tool.started')).toBe(false)},45000);

test('real Claude does not start Write before request settlement or after settlement failure',async()=>{
  const f=await fixture('write',true,'fail');expect(f.callsBeforeSettlement).toBe(0);expect(f.calls).toEqual([]);expect(f.written).toBe(false);expect(f.result.status).toBe('failed');
  expect(f.requests).toHaveLength(1);expect(f.budget).toMatchObject({reported:0,unknown:1});expect(f.events.some(e=>e.type==='tool.started')).toBe(false);
},45000);

test('real Claude writes only after delayed request settlement succeeds',async()=>{
  const f=await fixture('write',true,'success');expect(f.callsBeforeSettlement).toBe(0);expect(f.calls).toHaveLength(1);expect(f.written).toBe(true);expect(f.result.status).toBe('completed');
  expect(f.requests).toHaveLength(2);expect(f.budget).toMatchObject({reported:2,unknown:0});expect(f.events.filter(e=>e.type==='tool.finished')).toHaveLength(1);
},45000);
