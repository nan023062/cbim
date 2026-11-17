import type {OwnerExecutionSelection} from '../../../../../../src/logic/team/rules/member-execution-binding';
import assert from 'node:assert/strict';
import http from 'node:http';
import type {GoalFixtureRequest} from '../../../tasks/rules/support/goal-provider-fixture';

export const questionContractData={
  model:'question-contract-fixture',goal:'QUESTION_CONTRACT_MAIN: 询问汇报偏好，然后核实真实文件并交付',
  memberGoal:'QUESTION_CONTRACT_MEMBER: 问清核实偏好后真实读取 question-input.txt',
  acceptance:['真实读取 question-input.txt，问题回答不作为完成证据'],
  fact:'QUESTION_CONTRACT_REAL_FILE_5b910c',
  mainQuestions:[{question:'你希望如何呈现核实结果？',options:[{label:'简短列表',description:'保留证据引用'},{label:'连续短句',description:'简要说明'}]},{question:'还有哪些汇报边界？',options:[{label:'仅报告文件事实'},{label:'保留全部细节'}]}],
  memberQuestions:[{question:'执行成员按哪种方式核实文件？',options:[{label:'真实读取',description:'保存本轮工具回执'},{label:'暂缓处理'}]}],
  mainAnswers:[{option:0,other:'保留真实读取引用'},{option:null,other:'只报告实际文件核实，不作为人工验收'}],
  memberAnswers:[{option:0,other:'不以问答代替验证'}],
  final:'已完成真实文件读取和证据审阅；问题回答仅用于沟通，不代替业务验证。',
};
export type QuestionContractMode='complete'|'cancel-question'|'invalid-output'|'stop';
type Request=GoalFixtureRequest&{model:string;tools?:{function:{name:string}}[]};
function response(body:Request,id:string){const value=body.messages.find(message=>message.role==='tool'&&message.tool_call_id===id);assert.ok(value,'缺少真实工具回包 '+id);return typeof value.content==='string'?value.content:JSON.stringify(value.content)}
function wire(body:Request,id:string){let output=JSON.parse(response(body,id));if(Array.isArray(output?.content))output=JSON.parse(output.content.map((part:{text?:string})=>part.text??'').join(''));return output}

/** 模型只产生可控工具序列；问题消费、文件读取、工具证据门禁和调度结算全部真实。 */
export async function questionContractProvider(mode:QuestionContractMode='complete',options:{holdAfterAnswer?:boolean}={}){
  const mainRequests:Request[]=[],memberRequests:Request[]=[],errors:string[]=[];let ownerSelection:OwnerExecutionSelection|undefined;let moduleId='';const state:{waiting?:any;result?:any;check?:any}={};
  let releaseAnswer!:()=>void;const answered=new Promise<void>(resolve=>releaseAnswer=resolve);if(!options.holdAfterAnswer)releaseAnswer();
  const server=http.createServer(async(req,res)=>{try{
    assert.equal(req.method,'POST');let text='';for await(const chunk of req)text+=chunk;const body=JSON.parse(text) as Request;
    const main=body.tools?.some(tool=>tool.function.name==='cbim_agent_result_review')===true,requests=main?mainRequests:memberRequests,turn=requests.length;requests.push(body);
    res.writeHead(200,{'Content-Type':'text/event-stream'});
    const emit=(delta:unknown,finish_reason:string|null=null)=>res.write('data: '+JSON.stringify({id:'question-contract-'+(mainRequests.length+memberRequests.length),object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta,finish_reason}]})+'\n\n');
    const tool=(id:string,name:string,args:unknown)=>{assert.ok(body.tools?.some(tool=>tool.function.name===name),name);emit({role:'assistant',tool_calls:[{index:0,id,type:'function',function:{name,arguments:JSON.stringify(args)}}]});emit({},'tool_calls')};
    const reply=(content:string)=>{emit({role:'assistant',content});emit({},'stop')};
    if(main){
      assert.ok(ownerSelection,'Fixture must bind an actual registered owner before business planning');
      if(turn===0)tool('question-main-ask','cbim_ask_user_question',{questions:questionContractData.mainQuestions});
      else if(turn===1){assert.deepEqual(wire(body,'question-main-ask'),{answers:[{question:questionContractData.mainQuestions[0].question,answer:'简短列表',supplement:'保留真实读取引用'},{question:questionContractData.mainQuestions[1].question,answer:'只报告实际文件核实，不作为人工验收'}]});tool('question-call','cbim_agent_call',{agentId:ownerSelection.memberId,message:questionContractData.memberGoal,business:{moduleIds:[moduleId],acceptance:questionContractData.acceptance}})}
      else if(turn===2){state.waiting=wire(body,'question-call');assert.equal(state.waiting.status,'waiting');assert.deepEqual(state.waiting.questions.questions,questionContractData.memberQuestions);tool('question-parent-relay','cbim_ask_user_question',state.waiting.questions)}
      else if(turn===3)tool('question-parent-answer','cbim_agent_reply',{callId:'question-call',questionId:state.waiting.questionId,result:wire(body,'question-parent-relay')});
      else if(turn===4){state.result=wire(body,'question-parent-answer');assert.equal(state.result.status,'completed');tool('question-check','cbim_agent_result_check',{callId:'question-call'})}
      else if(turn===5){state.check=wire(body,'question-check');assert.equal(state.check.state,'verified');reply(questionContractData.final)}

      else throw Error('禁止自动重问或重复主运行 '+turn);
    }else{
      if(turn===0)tool('question-member-ask','cbim_ask_user_question',{questions:questionContractData.memberQuestions});
      else if(turn===1){
        await answered;
        if(mode==='invalid-output')assert.ok(response(body,'question-member-ask').includes('TOOL_OUTPUT_INVALID'),'真实消费后坏wire必须失败');
        else if(mode==='cancel-question')assert.deepEqual(wire(body,'question-member-ask'),{cancelled:true});
        else assert.deepEqual(wire(body,'question-member-ask'),{answers:[{question:questionContractData.memberQuestions[0].question,answer:'真实读取',supplement:'不以问答代替验证'}]});
        tool('question-member-plan','cbim_task_plan',{expectedVersion:0,goal:questionContractData.memberGoal,reason:'问题只沟通偏好，真实文件仍需核实',acceptance:questionContractData.acceptance,steps:[{id:'read',title:'读取真实文件',owner:'开发者'}]});
      }else if(turn===2)tool('question-bad-step','cbim_task_step',{expectedVersion:1,id:'read',state:'reported_done',evidenceIds:['question-member-ask']});
      else if(turn===3){assert.match(response(body,'question-bad-step'),/证据不存在、已过期或不属于本轮/,'问答回执不能作为完成证据');tool('question-real-read','read',{path:'question-input.txt'})}
      else if(turn===4){assert.ok(JSON.stringify(body.messages).includes(questionContractData.fact));tool('question-good-step','cbim_task_step',{expectedVersion:1,id:'read',state:'reported_done',evidenceIds:['question-real-read']})}
      else if(turn===5)tool('question-delivery','cbim_delivery_prepare',{expectedVersion:2,summary:'实际读取 '+questionContractData.fact,limitations:['用户回答不等于人工验收或权限批准']});
      else if(turn===6)reply('真实读取证据已提交。');
      else throw Error('禁止自动重问或重复成员运行 '+turn);
    }
    res.end('data: [DONE]\n\n');
  }catch(error){errors.push(String(error));if(!res.headersSent)res.writeHead(500);res.end('Question contract fixture failure')}});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address!=='string');
  return {url:`http://127.0.0.1:${address.port}/v1`,mainRequests,memberRequests,errors,state,releaseAnswer,bind:(_agent:string,module:string,selection:OwnerExecutionSelection)=>{moduleId=module;ownerSelection=structuredClone(selection)},close:async()=>{releaseAnswer();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}};
}
