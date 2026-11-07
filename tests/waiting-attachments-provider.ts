import assert from 'node:assert/strict';
import http from 'node:http';
import {goalCompleteArguments,goalInspection,goalPlanArguments,type GoalFixtureRequest} from './goal-provider-fixture';

export const attachmentFixture={
  mainGoal:'WAIT_ATTACH_MAIN: 核实项目文件，等待补充参考资料后再复核并汇报',
  memberGoal:'WAIT_ATTACH_MEMBER: 真实读取 waiting-input.txt 并提交核实证据',
  secondGoal:'WAIT_ATTACH_MEMBER_SECOND: 根据补充后计划重新读取 waiting-input.txt',
  acceptance:['实际读取 waiting-input.txt 并提交可追溯回执'],
  fact:'WAIT_ATTACH_REAL_FILE_28e0ab',
  text:'WAIT_ATTACH_SNAPSHOT_TEXT_4c7d9a：采用简短列表；图片仅作参考，不是业务验证或人工批准。',
  supplement:'请使用所附文本与图片参考，重新核实文件后简短汇报。',
  waitReason:'请补充参考文本和图片；文件核实候选保留，当前尚未完成目标。',
  waitingFinal:'已进入安全等待，请显式补充参考资料。',
  live:'补充已进入原会话，正在重新规划核实。',
  final:'已读取参考快照并重新核实文件，真实读取证据已交回主会话。',
};
export type AttachmentProviderRequest=GoalFixtureRequest&{model:string;tools?:{function:{name:string}}[]};
export function requestImages(body:AttachmentProviderRequest){return body.messages.flatMap(message=>Array.isArray(message.content)?message.content.filter((part:unknown)=>typeof part==='object'&&part!==null&&'type'in part&&part.type==='image_url'):[]) as {type:'image_url';image_url:{url:string}}[]}

/** 只有模型响应确定；Pi、工具、工作区快照、真实读文件、等待/补充及回注均经过产品。 */
export async function waitingAttachmentsProvider(){
  const mainRequests:AttachmentProviderRequest[]=[],memberRequests:AttachmentProviderRequest[]=[],errors:string[]=[];
  let agentId='',moduleId='',expectedImage='',release=()=>{};
  const gate=new Promise<void>(resolve=>{release=resolve});
  const server=http.createServer(async(req,res)=>{
    try{
      assert.equal(req.method,'POST');assert.ok(req.url?.endsWith('/chat/completions'));
      let raw='';for await(const part of req)raw+=part;const body=JSON.parse(raw) as AttachmentProviderRequest;
      const main=body.tools?.some(tool=>tool.function.name==='cbim_dispatch_task')===true,list=main?mainRequests:memberRequests,turn=list.length;list.push(body);
      res.writeHead(200,{'Content-Type':'text/event-stream'});
      const emit=(delta:unknown,finish_reason:string|null=null)=>res.write('data: '+JSON.stringify({id:'waiting-attachments-'+(mainRequests.length+memberRequests.length),object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta,finish_reason}]})+'\n\n');
      const tool=(id:string,name:string,args:unknown)=>{emit({role:'assistant',tool_calls:[{index:0,id,type:'function',function:{name,arguments:JSON.stringify(args)}}]});emit({},'tool_calls')};
      const reply=(content:string)=>{emit({role:'assistant',content});emit({},'stop')};
      const plan=(revision=1)=>goalPlanArguments({objective:attachmentFixture.mainGoal,agentId,moduleIds:[moduleId],acceptance:attachmentFixture.acceptance},revision);
      const dispatch=(goal:string)=>({agentId,moduleIds:[moduleId],goal,acceptance:attachmentFixture.acceptance.map((text,index)=>({id:'criterion-'+index,text})),prerequisites:[]});
      if(main){
        if(turn===0)tool('attach-initial-plan','cbim_goal_plan',plan());
        else if(turn===1)tool('attach-initial-dispatch','cbim_dispatch_task',dispatch(attachmentFixture.memberGoal));
        else if(turn===2)reply('已派发真实文件读取。');
        else if(turn===3)tool('attach-wait-inspect','cbim_goal_inspect',{});
        else if(turn===4)tool('attach-wait-review','cbim_goal_review',{...goalCompleteArguments(body,'attach-wait-inspect'),decision:'awaiting_user',gaps:[attachmentFixture.waitReason],reason:attachmentFixture.waitReason});
        else if(turn===5)reply(attachmentFixture.waitingFinal);
        else if(turn===6){
          const user=body.messages.filter(message=>message.role==='user').at(-1);
          assert.ok(JSON.stringify(user?.content).includes(attachmentFixture.supplement));assert.ok(JSON.stringify(user?.content).includes(attachmentFixture.text));
          assert.deepEqual(requestImages(body),[{type:'image_url',image_url:{url:'data:image/png;base64,'+expectedImage}}]);
          emit({role:'assistant',content:attachmentFixture.live});await gate;tool('attach-continue-inspect','cbim_goal_inspect',{});
        }else if(turn===7){const {scope}=goalInspection(body,'attach-continue-inspect');tool('attach-replan','cbim_goal_plan',{...plan(scope.goal.revision),constraints:['参考附件不等于业务证据或人工批准','由新执行成员重新读取文件'],reason:'显式附件补充后重新核实目标和证据要求'})}
        else if(turn===8)tool('attach-second-dispatch','cbim_dispatch_task',dispatch(attachmentFixture.secondGoal));
        else if(turn===9)reply('按新计划派发独立只读成员，等待其结果。');
        else if(turn===10){assert.equal(requestImages(body).length,1,'后续完整请求保留历史图片一次，不重复追加用户图消息');tool('attach-final-inspect','cbim_goal_inspect',{})}
        else if(turn===11)tool('attach-final-review','cbim_goal_review',goalCompleteArguments(body,'attach-final-inspect'));
        else if(turn===12)reply(attachmentFixture.final);
        else throw Error('附件原命令不得重复启动：'+turn);
      }else{
        assert.equal(requestImages(body).length,0,'参考图不自动扩散到独立成员上下文');
        const round=Math.floor(turn/5),stage=turn%5;assert.ok(round<2,'不得重放成员');const id='attach-member-'+round;
        if(stage===0)tool(id+'-plan','cbim_task_plan',{expectedVersion:0,goal:round===0?attachmentFixture.memberGoal:attachmentFixture.secondGoal,reason:'只核实真实文件，不凭参考图片代替验证',acceptance:attachmentFixture.acceptance,steps:[{id:'read',title:'读取真实文件',owner:'开发者'}]});
        else if(stage===1)tool(id+'-read','read',{path:'waiting-input.txt'});
        else if(stage===2){assert.ok(JSON.stringify(body.messages).includes(attachmentFixture.fact));tool(id+'-step','cbim_task_step',{expectedVersion:1,id:'read',state:'reported_done',evidenceIds:[id+'-read']})}
        else if(stage===3)tool(id+'-delivery','cbim_delivery_prepare',{expectedVersion:2,summary:'真实读取 '+attachmentFixture.fact,limitations:['参考附件未被认定为业务文件验证或人工验收']});
        else reply('真实文件读取候选已提交。');
      }
      res.write('data: '+JSON.stringify({id:'waiting-attachments-usage',object:'chat.completion.chunk',created:1,model:body.model,choices:[],usage:{prompt_tokens:100,completion_tokens:20,total_tokens:120}})+'\n\n');
      res.end('data: [DONE]\n\n');
    }catch(error){errors.push(String(error));if(!res.headersSent)res.writeHead(500);res.end('Waiting attachment fixture failure')}
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address!=='string');
  return {url:`http://127.0.0.1:${address.port}/v1`,mainRequests,memberRequests,errors,bind:(agent:string,module:string,image:string)=>{agentId=agent;moduleId=module;expectedImage=image},release,close:async()=>{release();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}};
}
