import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {CodexEngine} from '../src/backend/engines/codex/engine';
import type {EngineContext,EngineEvent,ToolCall} from '../src/backend/core/execution/types';
import type {ResolvedLlm} from '../src/backend/core/models/ports';

export function codexResponse(res:http.ServerResponse,call?:{id:string;name:string;input:unknown}){
  res.writeHead(200,{'content-type':'text/event-stream'});let sequence_number=0;const send=(value:any)=>res.write('event: '+value.type+'\ndata: '+JSON.stringify({...value,sequence_number:sequence_number++})+'\n\n');
  const responseId='resp_'+randomUUID(),item=call?{type:'function_call',id:'fc_'+randomUUID(),call_id:call.id,name:call.name,arguments:JSON.stringify(call.input),status:'completed'}:{type:'message',id:'msg_'+randomUUID(),role:'assistant',status:'completed',content:[{type:'output_text',text:'CBIM Codex OK',annotations:[]}]};
  send({type:'response.created',response:{id:responseId,status:'in_progress',output:[]}});
  send({type:'response.output_item.added',output_index:0,item:call?{...item,arguments:'',status:'in_progress'}:{...item,content:[],status:'in_progress'}});
  if(call)send({type:'response.function_call_arguments.delta',item_id:item.id,output_index:0,delta:JSON.stringify(call.input)});
  else{send({type:'response.content_part.added',item_id:item.id,output_index:0,content_index:0,part:{type:'output_text',text:'',annotations:[]}});send({type:'response.output_text.delta',item_id:item.id,output_index:0,content_index:0,delta:'CBIM Codex OK'});send({type:'response.output_text.done',item_id:item.id,output_index:0,content_index:0,text:'CBIM Codex OK'})}
  send({type:'response.output_item.done',output_index:0,item});
  send({type:'response.completed',response:{id:responseId,status:'completed',output:[item],usage:{input_tokens:100,output_tokens:20,total_tokens:120,input_tokens_details:{cached_tokens:0},output_tokens_details:{reasoning_tokens:0}}}});res.end();
}
export async function codexFixture(options:{tool?:'internal'|'read'|'write'|'bash';allow?:boolean|'throw';hold?:boolean;failFirst?:boolean;afterTool?:'incomplete'|'hold'}={}){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-codex-')),cwd=path.join(root,'project'),home=path.join(root,'engine');await fs.mkdir(cwd);await fs.writeFile(path.join(cwd,'sample.txt'),'sample content');
  const calls:ToolCall[]=[],events:EngineEvent[]=[],invocations:unknown[]=[],requests:any[]=[],errors:string[]=[];
  const callId='tool_'+randomUUID(),tool=options.tool,input=tool==='write'?{path:path.join(cwd,'written.txt'),content:'Codex wrote this'}:tool==='read'?{path:path.join(cwd,'sample.txt')}:tool==='bash'?{command:'echo cbim-codex-command'}:{value:'test'},name=tool==='internal'?'cbim_test_read':'cbim_native_'+tool;
  let arrived!:()=>void;const received=new Promise<void>(resolve=>{arrived=resolve});
  const server=http.createServer(async(req,res)=>{try{let text='';for await(const chunk of req)text+=chunk;const body=JSON.parse(text);requests.push({url:req.url,body});arrived();if(options.hold)return;if(options.failFirst&&requests.length===1){res.writeHead(400,{'content-type':'application/json'});res.end(JSON.stringify({error:{message:'Invalid test tool schema',type:'invalid_request_error'}}));return}
    if(requests.length===2&&options.afterTool){
      if(options.afterTool==='hold')return;
      res.writeHead(200,{'content-type':'text/event-stream'});
      res.end('event: response.incomplete\ndata: '+JSON.stringify({type:'response.incomplete',response:{id:'resp_incomplete',status:'incomplete',output:[],incomplete_details:{reason:'max_output_tokens'}}})+'\n\n');return;
    }
    codexResponse(res,tool&&requests.length===1?{id:callId,name,input}:undefined)
  }catch(error){errors.push(String(error));res.destroy()}});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const llm:ResolvedLlm={apiKey:'test-codex-key',profile:{engine:'codex',id:randomUUID(),name:'Codex test',api:'openai-responses',auth:'api-key',baseUrl:'http://127.0.0.1:'+(server.address() as any).port+'/v1',model:'codex-test-model',contextWindow:200000,maxTokens:4096,reasoning:false}};
  const engineOptions={agentHome:home,prompt:'Use only the CBIM tools.',llm,allowNativeExecution:true,turnTimeoutMs:15000,knowledge:{list:async()=>[{name:'cbim_test_read',description:'Read test data',inputSchema:{type:'object',properties:{value:{type:'string'}},required:['value'],additionalProperties:false}}],call:async(name:string,args:unknown,signal:AbortSignal,id?:string)=>{signal.throwIfAborted();invocations.push({name,args,id});return {content:[{type:'text',text:'test result'}]}}}};
  const context:EngineContext={task:{taskId:randomUUID(),workspaceId:'test',root:cwd,mode:'chat',agentId:'cbim:main',goal:'test',moduleIds:[],acceptance:[]},runId:randomUUID(),directory:path.join(root,'run'),emit:async event=>{events.push(event)},beforeTool:async call=>{calls.push(call);if(options.allow==='throw')throw Error('test authorization unavailable');return {allow:options.allow??true,reason:'CBIM test gate'}}};
  const engine=new CodexEngine(engineOptions);
  return {root,cwd,home,llm,engine,engineOptions,context,events,calls,invocations,requests,errors,received,callId,input,cleanup:async()=>{await engine.close();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));if(path.dirname(root)!==path.resolve(os.tmpdir())||!path.basename(root).startsWith('cbim-codex-'))throw Error('unexpected cleanup');await fs.rm(root,{recursive:true,force:true,maxRetries:8,retryDelay:150})}};
}
