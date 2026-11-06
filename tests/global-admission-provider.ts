import assert from 'node:assert/strict';
import http from 'node:http';
import {goalCompleteArguments,goalPlanArguments,type GoalFixtureRequest} from './goal-provider-fixture';

export type AdmissionProject='a'|'b';
export const globalAdmissionFixture={
  goal:(key:AdmissionProject)=>`GLOBAL_ADMISSION_${key.toUpperCase()}: 由独立成员核实本工作区文件，按真实证据完成目标`,
  memberGoal:(key:AdmissionProject)=>`GLOBAL_MEMBER_${key.toUpperCase()}: 读取 admission-source.txt 并提交可核实的证据`,
  fact:(key:AdmissionProject)=>`GLOBAL_ADMISSION_FACT_${key.toUpperCase()}_4f82`,
  model:(key:AdmissionProject)=>`admission-${key}`,
  acceptance:['实际读取本工作区 admission-source.txt 并提交读取回执'],
  file:'admission-source.txt',
  rejectedDraft:'GLOBAL_CAPACITY_DRAFT: 这是额度不足时尚未受理的新对话，必须保留草稿。',
};
type Request=GoalFixtureRequest&{model:string;tools?:{function:{name:string}}[]};
function gate(){let release=()=>{};const promise=new Promise<void>(resolve=>{release=resolve});return {promise,release}}

/** Only model responses are deterministic: both workspaces use real Pi and real native reads. */
export async function globalAdmissionProvider(){
  const d=globalAdmissionFixture,keys:AdmissionProject[]=['a','b'],errors:string[]=[],sequence:string[]=[];
  const projects=Object.fromEntries(keys.map(key=>[key,{main:[] as Request[],member:[] as Request[],agentId:'',moduleId:'',mainGate:gate(),memberGate:gate()}])) as Record<AdmissionProject,{main:Request[];member:Request[];agentId:string;moduleId:string;mainGate:ReturnType<typeof gate>;memberGate:ReturnType<typeof gate>}>;
  const server=http.createServer(async(req,res)=>{try{
    assert.equal(req.method,'POST');assert.ok(req.url?.endsWith('/chat/completions'));let raw='';for await(const chunk of req)raw+=chunk;
    const body=JSON.parse(raw) as Request,key=keys.find(item=>d.model(item)===body.model);assert.ok(key,'Unexpected isolated model');
    const project=projects[key],isMain=body.tools?.some(tool=>tool.function.name==='cbim_dispatch_task')===true,requests=isMain?project.main:project.member,turn=requests.length;requests.push(body);sequence.push(`${key}:${isMain?'main':'member'}:${turn}`);
    res.writeHead(200,{'Content-Type':'text/event-stream'});
    const emit=(delta:unknown,finish_reason:string|null=null)=>res.write('data: '+JSON.stringify({id:'admission-'+sequence.length,object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta,finish_reason}]})+'\n\n');
    const tool=(id:string,name:string,args:unknown)=>{emit({role:'assistant',tool_calls:[{index:0,id,type:'function',function:{name,arguments:JSON.stringify(args)}}]});emit({},'tool_calls')};
    const reply=(text:string)=>{emit({role:'assistant',content:text});emit({},'stop')};
    if(isMain){
      assert.ok(body.tools?.every(item=>!['write','edit','bash'].includes(item.function.name)));
      if(turn===0)tool(key+'-goal-plan','cbim_goal_plan',goalPlanArguments({objective:d.goal(key),agentId:project.agentId,moduleIds:[project.moduleId],acceptance:d.acceptance}));
      else if(turn===1)tool(key+'-dispatch','cbim_dispatch_task',{agentId:project.agentId,moduleIds:[project.moduleId],goal:d.memberGoal(key),acceptance:d.acceptance.map((text,index)=>({id:'criterion-'+index,text})),prerequisites:[]});
      else if(turn===2){emit({role:'assistant',content:`${key.toUpperCase()} 的成员任务已经受理，主轮暂未结束。`});await project.mainGate.promise;reply('主轮结束，等待成员安全执行。')}
      else if(turn===3)tool(key+'-goal-inspect','cbim_goal_inspect',{});
      else if(turn===4)tool(key+'-goal-review','cbim_goal_review',goalCompleteArguments(body,key+'-goal-inspect'));
      else if(turn===5)reply(`${key.toUpperCase()} 工作区的独立成员已提交真实文件读取证据，目标完成。`);
      else throw Error('Admission or restart unexpectedly replayed a main model: '+key+':'+turn);
    }else{
      assert.ok(body.tools?.every(item=>item.function.name!=='cbim_dispatch_task'));
      if(turn===0){emit({role:'assistant',content:`${key.toUpperCase()} 成员已取得运行资格，等待本机验证闸门。`});await project.memberGate.promise;tool(key+'-task-plan','cbim_task_plan',{expectedVersion:0,goal:d.memberGoal(key),reason:'独立读取本工作区文件',acceptance:d.acceptance,steps:[{id:'verify',title:'读取文件并提交证据',owner:'开发者'}]})}
      else if(turn===1)tool(key+'-read','read',{path:d.file});
      else if(turn===2){assert.ok(JSON.stringify(body.messages).includes(d.fact(key)));tool(key+'-step','cbim_task_step',{expectedVersion:1,id:'verify',state:'reported_done',evidenceIds:[key+'-read']})}
      else if(turn===3)tool(key+'-delivery','cbim_delivery_prepare',{expectedVersion:2,summary:'真实读取证据：'+d.fact(key),limitations:['只核实读取事实，不代替人工业务验收']});
      else if(turn===4)reply('成员已提交真实读取候选。');
      else throw Error('Admission or restart unexpectedly replayed a member: '+key+':'+turn);
    }
    res.end('data: [DONE]\n\n');
  }catch(error){errors.push(String(error));if(!res.headersSent)res.writeHead(500);res.end('Global admission fixture failed')}});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address!=='string');
  const releaseAll=()=>{for(const project of Object.values(projects)){project.mainGate.release();project.memberGate.release()}};
  return {url:`http://127.0.0.1:${address.port}/v1`,projects,sequence,errors,bind:(key:AdmissionProject,agentId:string,moduleId:string)=>Object.assign(projects[key],{agentId,moduleId}),releaseMain:(key:AdmissionProject)=>projects[key].mainGate.release(),releaseMember:(key:AdmissionProject)=>projects[key].memberGate.release(),releaseAll,close:async()=>{releaseAll();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}};
}
