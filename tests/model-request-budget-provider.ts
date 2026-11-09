import http from 'node:http';
import assert from 'node:assert/strict';
import type {ResolvedLlm} from '../src/backend/core/brain/llm/ports';
export type RequestBudgetMode='plain'|'two-requests'|'unknown'|'retry'|'compaction';
/** Only the model response is deterministic; requests still traverse actual Pi, bootstrap, proxy and durable ledger. */
export async function modelRequestBudgetProvider(api:ResolvedLlm['profile']['api']='openai-completions',mode:RequestBudgetMode='plain'){
  const requests:{body:any;path:string;compaction:boolean}[]=[],errors:string[]=[];
  const server=http.createServer(async(req,res)=>{try{
    assert.equal(req.method,'POST');let raw='';for await(const part of req)raw+=part;const body=JSON.parse(raw);assert.equal(body.model,'request-budget-model');
    const compaction=!!body.messages?.some((m:any)=>m.role==='system'&&typeof m.content==='string'&&m.content.includes('context summarization assistant'));
    requests.push({body,path:req.url??'',compaction});const turn=requests.length;
    res.writeHead(200,{'content-type':'text/event-stream'});const event=(value:any)=>res.write((api==='anthropic-messages'?'event: '+value.type+'\n':'')+'data: '+JSON.stringify(value)+'\n\n');
    if(api==='openai-completions'){
      const firstTool=(mode==='two-requests'||mode==='compaction')&&turn===1;
      event({id:'request-budget-'+turn,object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta:firstTool?{role:'assistant',tool_calls:[{index:0,id:'budget-identity',type:'function',function:{name:'cbim_workspace_identity',arguments:'{}'}}]}:{role:'assistant',content:compaction?'Context summarized. Continue with the requested final answer.':mode==='compaction'&&turn===2?'Long native conversation context. '.repeat(3000):'Request budget verified.'},finish_reason:null}]});
      if(mode==='retry'){res.end();return}
      event({id:'request-budget-'+turn,object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta:{},finish_reason:firstTool?'tool_calls':'stop'}],...(mode==='unknown'?{}:{usage:{prompt_tokens:mode==='compaction'&&turn===2?25000:100,completion_tokens:mode==='compaction'&&turn===2?25000:20,total_tokens:mode==='compaction'&&turn===2?50000:120,prompt_tokens_details:{cached_tokens:30},completion_tokens_details:{reasoning_tokens:10}}})});res.write('data: [DONE]\n\n');
    }else if(api==='openai-responses')event({type:'response.completed',response:{id:'resp_budget',object:'response',created_at:1,status:'completed',model:body.model,output:[{type:'message',id:'msg_budget',role:'assistant',status:'completed',content:[{type:'output_text',text:'Request budget verified.',annotations:[]}]}],usage:{input_tokens:100,output_tokens:20,total_tokens:120,input_tokens_details:{cached_tokens:30},output_tokens_details:{reasoning_tokens:10}}}});
    else{
      event({type:'message_start',message:{id:'msg_budget',type:'message',role:'assistant',model:body.model,content:[],stop_reason:null,usage:{input_tokens:70,output_tokens:0,cache_read_input_tokens:30}}});event({type:'content_block_start',index:0,content_block:{type:'text',text:''}});event({type:'content_block_delta',index:0,delta:{type:'text_delta',text:'Request budget verified.'}});event({type:'content_block_stop',index:0});event({type:'message_delta',delta:{stop_reason:'end_turn'},usage:{output_tokens:20}});event({type:'message_stop'});
    }res.end();
  }catch(error){errors.push(String(error));res.destroy()}});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+(server.address() as import('node:net').AddressInfo).port;
  return {api,mode,requests,errors,url:api==='anthropic-messages'?origin:origin+'/v1',close:async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}};
}
