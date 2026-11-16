import assert from 'node:assert/strict';
import http from 'node:http';
import type {OwnerExecutionSelection} from '../src/logic/team/rules/member-execution-binding';

export const queuedTaskCancelFixture={
  mainGoal:'CANCEL_CHAIN: read A then B then C, ask before continuing A',
  freshGoal:'FRESH_CHAIN: explicitly read A then B then C after previous cancellation',
  files:['cancel-a.txt','cancel-b.txt','cancel-c.txt'],
  facts:['CANCEL_FACT_A_5d82','CANCEL_FACT_B_e791','CANCEL_FACT_C_70a1'],
  question:'May A continue with the supplied instructions?',
};
type Request={messages:{role:string;content:unknown;tool_call_id?:string}[];tools?:{function:{name:string}}[];model:string};
function value(body:Request,id:string){
  const item=body.messages.filter(message=>message.role==='tool'&&message.tool_call_id===id).at(-1);
  assert.ok(item,'Missing original tool result '+id);return JSON.parse(String(item.content));
}
/** Deterministic model only. Real Pi, nested loops, questions, files and logs are not replaced. */
export async function queuedTaskCancelProvider(mode:'complete'|'stop'|'cancel-not-success'){
  const mainRequests:Request[]=[],memberRequests:Request[]=[],errors:string[]=[];
  const children=new Map<string,Request[]>();let memberId='',freshTurns=0,originalTurns=0;
  const server=http.createServer(async(req,res)=>{
    try{
      let raw='';for await(const chunk of req)raw+=chunk;
      const body=JSON.parse(raw) as Request;
      assert.ok(!body.tools?.some(tool=>['cbim_dispatch_task','cbim_dispatch_cancel','cbim_goal_plan'].includes(tool.function.name)));
      const root=body.tools?.some(tool=>tool.function.name==='cbim_agent_result_review');
      const fresh=JSON.stringify(body.messages.filter(message=>message.role==='user').at(-1)?.content).includes(queuedTaskCancelFixture.freshGoal);
      res.writeHead(200,{'Content-Type':'text/event-stream'});
      const emit=(delta:unknown,finish_reason:string|null)=>res.write('data: '+JSON.stringify({id:'cancel-chain',object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta,finish_reason}]})+'\n\n');
      const tool=(id:string,name:string,args:unknown)=>{emit({role:'assistant',tool_calls:[{index:0,id,type:'function',function:{name,arguments:JSON.stringify(args)}}]},null);emit({},'tool_calls')};
      const reply=(content:string)=>{emit({role:'assistant',content},null);emit({},'stop')};
      const call=(index:number)=>tool((fresh?'new-':'old-')+index,'cbim_agent_call',{agentId:memberId,message:'CHAIN_CHILD_'+index+(fresh?'_NEW':'_OLD')});
      if(root){
        mainRequests.push(body);const turn=fresh?freshTurns++:originalTurns++;
        if(fresh){
          if(turn>0){const prior=value(body,'new-'+(turn-1));assert.equal(prior.status,'completed');assert.ok(prior.summary.includes(queuedTaskCancelFixture.facts[turn-1]))}
          if(turn<3)call(turn);else reply('Fresh chain completed with '+queuedTaskCancelFixture.facts.join(','));
        }else if(turn===0)call(0);
        else if(turn===1){
          const waiting=value(body,'old-0');assert.equal(waiting.status,'waiting');
          if(mode==='cancel-not-success')reply('No answer was obtained; this is not completed.');
          else tool('ask-user','cbim_ask_user_question',waiting.questions);
        }else if(turn===2){
          const waiting=value(body,'old-0');tool('wrong-question','cbim_agent_reply',{callId:waiting.callId,questionId:'not-the-original-question',result:value(body,'ask-user')});
        }else if(turn===3){
          assert.equal(value(body,'wrong-question').error.code,'AGENT_QUESTION_STALE');
          const waiting=value(body,'old-0');tool('continue-a','cbim_agent_reply',{callId:waiting.callId,questionId:waiting.questionId,result:value(body,'ask-user')});
        }else if(turn===4){
          const done=value(body,'continue-a');assert.equal(done.status,'completed');assert.ok(done.summary.includes(queuedTaskCancelFixture.facts[0]));call(1);
        }else if(turn===5){
          const done=value(body,'old-1');assert.equal(done.status,'completed');assert.ok(done.summary.includes(queuedTaskCancelFixture.facts[1]));call(2);
        }else {const done=value(body,'old-2');assert.equal(done.status,'completed');assert.ok(done.summary.includes(queuedTaskCancelFixture.facts[2]));reply('Original chain completed')}
      }else{
        memberRequests.push(body);
        const text=JSON.stringify(body.messages.filter(message=>message.role==='user').at(-1)?.content);
        const match=text.match(/CHAIN_CHILD_([012])_(NEW|OLD)/);assert.ok(match,'Child input must have exact requested identity');
        const key=match[0],index=Number(match[1]),history=children.get(key)??[];const turn=history.length;history.push(body);children.set(key,history);
        const asks=index===0&&match[2]==='OLD';
        if(asks&&turn===0)tool('child-ask','cbim_ask_user_question',{questions:[{question:queuedTaskCancelFixture.question,options:[{label:'Continue'},{label:'Stop'}]}]});
        else if(turn===(asks?1:0)){
          if(asks)assert.equal(value(body,'child-ask').answers[0].answer,'Continue');
          tool('read-'+key,'read',{path:queuedTaskCancelFixture.files[index]});
        }else{assert.ok(JSON.stringify(body.messages).includes(queuedTaskCancelFixture.facts[index]));reply(queuedTaskCancelFixture.facts[index])}
      }
      res.end('data: [DONE]\n\n');
    }catch(error){errors.push(String(error));if(!res.headersSent)res.writeHead(500);res.end('fixture failure')}
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw Error('Missing provider port');
  return {url:'http://127.0.0.1:'+address.port+'/v1',mainRequests,memberRequests,children,errors,
    bind:(_agent:string,_module:string,selection:OwnerExecutionSelection)=>{memberId=selection.memberId},
    close:async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))},
  };
}
