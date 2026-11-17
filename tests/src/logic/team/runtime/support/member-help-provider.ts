import assert from 'node:assert/strict';
import http from 'node:http';
import type {OwnerExecutionSelection} from '../../../../../../src/logic/team/rules/member-execution-binding';
export const memberHelpFixture={
  mainGoal:'HELP_MAIN: ask an Agent to inspect the source, then resolve its missing input',
  memberGoal:'HELP_CHILD: read help-source.txt and ask the caller for the supplement',
  source:'help-source.txt',sourceText:'HELP_SOURCE_38a2',
  supplement:'help-supplement.txt',supplementText:'HELP_SUPPLEMENT_9b41',
  marker:'help-original-effect.txt',markerText:'HELP_EFFECT_ONCE_48a9\n',
  question:'Which supplement should this original call read?',
};
type Request={messages:{role:string;content:unknown;tool_call_id?:string}[];tools?:{function:{name:string}}[];model:string};
function result(body:Request,id:string){const item=body.messages.filter(x=>x.role==='tool'&&x.tool_call_id===id).at(-1);assert.ok(item);return JSON.parse(String(item.content))}
export async function memberHelpProvider(mode:'complete'|'waiting'|'stop'|'unknown-log'){
 const mainRequests:Request[]=[],memberRequests:Request[]=[],errors:string[]=[];let memberId='',releaseHelp!:()=>void;
 const gate=new Promise<void>(resolve=>releaseHelp=resolve);
 const server=http.createServer(async(req,res)=>{
  try{
   let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw) as Request;
   assert.ok(!body.tools?.some(t=>['cbim_dispatch_task','cbim_member_help'].includes(t.function.name)));
   const root=body.tools?.some(t=>t.function.name==='cbim_agent_result_review'),requests=root?mainRequests:memberRequests,turn=requests.length;requests.push(body);
   if(root&&turn===1)await gate;
   if(res.destroyed)return;
   res.writeHead(200,{'Content-Type':'text/event-stream'});
   const emit=(delta:unknown,finish_reason:string|null)=>res.write('data: '+JSON.stringify({id:'help-call',object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta,finish_reason}]})+'\n\n');
   const tool=(id:string,name:string,args:unknown)=>{emit({role:'assistant',tool_calls:[{index:0,id,type:'function',function:{name,arguments:JSON.stringify(args)}}]},null);emit({},'tool_calls')};
   const reply=(content:string)=>{emit({role:'assistant',content},null);emit({},'stop')};
   if(root){
    if(turn===0)tool('help-call','cbim_agent_call',{agentId:memberId,message:memberHelpFixture.memberGoal});
    else if(turn===1){
     const waiting=result(body,'help-call');assert.equal(waiting.status,'waiting');
     if(mode==='waiting'||mode==='stop')tool('ask-user','cbim_ask_user_question',waiting.questions);
     else tool('reply-original','cbim_agent_reply',{callId:waiting.callId,questionId:waiting.questionId,result:{answers:[{question:memberHelpFixture.question,answer:memberHelpFixture.supplement}]}});
    }else if(turn===2&&(mode==='waiting'||mode==='stop')){
     const waiting=result(body,'help-call');tool('reply-original','cbim_agent_reply',{callId:waiting.callId,questionId:waiting.questionId,result:result(body,'ask-user')});
    }else{
     const value=result(body,'reply-original');
     if(mode==='unknown-log'){assert.ok(value.error||value.status!=='completed');reply('Original log could not be verified. No replay.')}
     else {assert.equal(value.status,'completed');assert.ok(value.summary.includes(memberHelpFixture.supplementText));reply('Evidence returned to original caller')}
    }
   }else{
    const offset=mode==='complete'?1:0;
    if(mode==='complete'&&turn===0)tool('help-effect','write',{path:memberHelpFixture.marker,content:memberHelpFixture.markerText});
    else if(turn===offset)tool('help-source','read',{path:memberHelpFixture.source});
    else if(turn===offset+1){
     assert.ok(JSON.stringify(body.messages).includes(memberHelpFixture.sourceText));
     tool('help-question','cbim_ask_user_question',{questions:[{question:memberHelpFixture.question,options:[{label:memberHelpFixture.supplement},{label:'No supplement'}]}]});
    }else if(turn===offset+2){
     assert.equal(result(body,'help-question').answers[0].answer,memberHelpFixture.supplement);
     tool('help-supplement','read',{path:memberHelpFixture.supplement});
    }else{assert.ok(JSON.stringify(body.messages).includes(memberHelpFixture.supplementText));reply(memberHelpFixture.sourceText+' '+memberHelpFixture.supplementText)}
   }
   res.end('data: [DONE]\n\n');
  }catch(error){errors.push(String(error));if(!res.headersSent)res.writeHead(500);res.end('fixture failure')}
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw Error('no port');
 return {url:'http://127.0.0.1:'+address.port+'/v1',mainRequests,memberRequests,errors,releaseHelp,
  bind:(_agent:string,_module:string,selection:OwnerExecutionSelection)=>{memberId=selection.memberId},
  close:async()=>{releaseHelp();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}};
}
