import assert from 'node:assert/strict';
import http from 'node:http';
import {goalCompleteArguments,goalPlanArguments,type GoalFixtureRequest} from './goal-provider-fixture';

export const artifactBaselineFixture={
  goal:'ARTIFACT_BASELINE_MAIN: 独立读取业务文件、采集显式指纹并保留可核实证据',
  memberGoal:'ARTIFACT_BASELINE_MEMBER: 读取两份业务文件，记录当前字节基线，按真实读取回执交付',
  files:['artifact-baseline-source.txt','artifact-baseline-other.txt'],
  facts:['ARTIFACT_BASELINE_REAL_SOURCE_a792','ARTIFACT_BASELINE_REAL_OTHER_f3c1'],
  changed:'ARTIFACT_BASELINE_EXTERNAL_CHANGE_027b',
  model:'artifact-baseline-fixture',
  acceptance:['真实读取两份文件并引用可追溯回执；文件基线仅证明采集时的字节'],
  draft:'保留主对话草稿，手动文件核实不发送此内容。',
  final:'已记录真实读取及文件基线，指纹不代替人工业务验收。',
};
type Request=GoalFixtureRequest&{model:string;tools?:{function:{name:string}}[]};

/** Only localhost model responses are deterministic; native read/capture, journals and validation are real. */
export async function artifactBaselineProvider(){
  const d=artifactBaselineFixture,main:Request[]=[],member:Request[]=[],errors:string[]=[],sequence:string[]=[];
  let agentId='',moduleId='',release=()=>{};const capturedGate=new Promise<void>(resolve=>{release=resolve});
  const state:{captured?:unknown}={};
  const server=http.createServer(async(req,res)=>{try{
    assert.equal(req.method,'POST');assert.ok(req.url?.endsWith('/chat/completions'));let raw='';for await(const chunk of req)raw+=chunk;
    const body=JSON.parse(raw) as Request;assert.equal(body.model,d.model);
    const isMain=body.tools?.some(tool=>tool.function.name==='cbim_dispatch_task')===true,requests=isMain?main:member,turn=requests.length;requests.push(body);sequence.push(`${isMain?'main':'member'}:${turn}`);
    res.writeHead(200,{'Content-Type':'text/event-stream'});
    const emit=(delta:unknown,finish_reason:string|null=null)=>res.write('data: '+JSON.stringify({id:'artifact-baseline-'+sequence.length,object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta,finish_reason}]})+'\n\n');
    const tool=(id:string,name:string,args:unknown)=>{emit({role:'assistant',tool_calls:[{index:0,id,type:'function',function:{name,arguments:JSON.stringify(args)}}]});emit({},'tool_calls')};
    const reply=(content:string)=>{emit({role:'assistant',content});emit({},'stop')};
    if(isMain){
      assert.ok(body.tools?.every(tool=>!['write','edit','bash','cbim_task_artifact_capture'].includes(tool.function.name)));
      if(turn===0)tool('artifact-goal-plan','cbim_goal_plan',goalPlanArguments({objective:d.goal,agentId,moduleIds:[moduleId],acceptance:d.acceptance}));
      else if(turn===1)tool('artifact-dispatch','cbim_dispatch_task',{agentId,moduleIds:[moduleId],goal:d.memberGoal,acceptance:d.acceptance.map((text,index)=>({id:'criterion-'+index,text})),prerequisites:[]});
      else if(turn===2)reply('已派发独立执行成员，等待真实读取证据。');
      else if(turn===3)tool('artifact-goal-inspect','cbim_goal_inspect',{});
      else if(turn===4)tool('artifact-goal-review','cbim_goal_review',goalCompleteArguments(body,'artifact-goal-inspect'));
      else if(turn===5)reply(d.final);
      else throw Error('文件核实不应触发额外主请求：'+turn);
    }else{
      assert.ok(body.tools?.some(tool=>tool.function.name==='cbim_task_artifact_capture'),'真实成员工具清单必须包含受控采集');
      if(turn===0)tool('artifact-task-plan','cbim_task_plan',{expectedVersion:0,goal:d.memberGoal,reason:'读取真实文件再按调用引用采集字节',acceptance:d.acceptance,steps:[{id:'verify',title:'读取文件并提交真实证据',owner:'开发者'}]});
      else if(turn===1)tool('artifact-source-read','read',{path:d.files[0]});
      else if(turn===2)tool('artifact-other-read','read',{path:d.files[1]});
      else if(turn===3){for(const fact of d.facts)assert.ok(JSON.stringify(body.messages).includes(fact));tool('artifact-capture','cbim_task_artifact_capture',{expectedTaskProgressVersion:1,sourceToolCallIds:['artifact-source-read','artifact-other-read']})}
      else if(turn===4){
        const result=body.messages.find(message=>message.role==='tool'&&message.tool_call_id==='artifact-capture');assert.ok(result,'capture必须收到真实工具响应');
        const text=typeof result.content==='string'?result.content:Array.isArray(result.content)?result.content.map(item=>item&&typeof item==='object'&&'text' in item?String(item.text):'').join(''):'';
        let value=JSON.parse(text);if(Array.isArray(value.content))value=JSON.parse(value.content.filter((item:{type:string})=>item.type==='text').map((item:{text:string})=>item.text).join(''));
        assert.equal(value.state,'captured');assert.equal(typeof value.baseline?.baselineId,'string');state.captured=value;
        emit({role:'assistant',content:'文件基线已记录，等待测试控制的结束边界。'});await capturedGate;
        tool('artifact-task-step','cbim_task_step',{expectedVersion:1,id:'verify',state:'reported_done',evidenceIds:['artifact-source-read','artifact-other-read']});
      }else if(turn===5)tool('artifact-delivery','cbim_delivery_prepare',{expectedVersion:2,summary:'真实读取两份文件并记录显式指纹',limitations:['文件基线只代表采集时字节，不代替业务验收或覆盖其它文件']});
      else if(turn===6)reply('真实读取证据已提交，基线只读核实独立于候选验收。');
      else throw Error('文件核实不应重放成员：'+turn);
    }
    res.end('data: [DONE]\n\n');
  }catch(error){errors.push(String(error));if(!res.headersSent)res.writeHead(500);res.end('Artifact baseline fixture failed')}});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address!=='string');
  return {url:`http://127.0.0.1:${address.port}/v1`,main,member,errors,sequence,state,bind:(agent:string,module:string)=>{agentId=agent;moduleId=module},releaseMember:()=>release(),close:async()=>{release();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}};
}
