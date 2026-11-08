import assert from 'node:assert/strict';
import http from 'node:http';
import type {OwnerExecutionSelection} from '../src/backend/core/team/member-execution-binding';
import {goalPlanArguments,goalCompleteArguments,type GoalFixtureRequest} from './goal-provider-fixture';

export const outputManifestData={goal:'OUTPUT_MANIFEST_MAIN: 读取产物并记录声明目录的完整集合',memberGoal:'OUTPUT_MANIFEST_MEMBER: 读取产物文件并完整采集冻结目录',model:'output-manifest-fixture',root:'outputs',file:'outputs/result.txt',content:'ACTUAL_MANIFEST_CONTENT_8c42',acceptance:['读取真实产物并记录声明范围完整集合；清单不代替验收'],draft:'完整产物只读复核期间保留此草稿。',final:'已记录真实读取与完整集合，观察不代替业务验收。'};
type Request=GoalFixtureRequest&{model:string;tools?:Array<{function:{name:string}}>};
/** 只有本机模型响应固定；范围冻结、Pi、原生读取、完整目录枚举和持久日志均走实际应用。 */
export async function outputManifestProvider(){
  const d=outputManifestData,main:Request[]=[],member:Request[]=[],sequence:string[]=[],errors:string[]=[],state:{captured?:unknown}={};
  let agentId='',moduleId='',ownerSelection:OwnerExecutionSelection|undefined,release=()=>{};const gate=new Promise<void>(resolve=>{release=resolve});
  const server=http.createServer(async(req,res)=>{try{
    assert.equal(req.method,'POST');assert.ok(req.url?.endsWith('/chat/completions'));let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw) as Request;assert.equal(body.model,d.model);
    const isMain=body.tools?.some(tool=>tool.function.name==='cbim_dispatch_task')===true,requests=isMain?main:member,turn=requests.length;requests.push(body);sequence.push((isMain?'main:':'member:')+turn);
    res.writeHead(200,{'Content-Type':'text/event-stream'});const emit=(delta:unknown,finish_reason:string|null=null)=>res.write('data: '+JSON.stringify({id:'manifest-'+sequence.length,object:'chat.completion.chunk',created:1,model:d.model,choices:[{index:0,delta,finish_reason}]})+'\n\n');
    const tool=(id:string,name:string,args:unknown)=>{emit({role:'assistant',tool_calls:[{index:0,id,type:'function',function:{name,arguments:JSON.stringify(args)}}]});emit({},'tool_calls')},reply=(content:string)=>{emit({role:'assistant',content});emit({},'stop')};
    if(isMain){
      assert.ok(body.tools?.every(tool=>!tool.function.name.startsWith('cbim_task_manifest_')));
      if(turn===0)tool('manifest-goal-plan','cbim_goal_plan',goalPlanArguments({objective:d.goal,agentId,ownerSelection,moduleIds:[moduleId],acceptance:d.acceptance}));
      else if(turn===1)tool('manifest-dispatch','cbim_dispatch_task',{agentId,ownerSelection,moduleIds:[moduleId],goal:d.memberGoal,acceptance:d.acceptance.map((text,i)=>({id:'criterion-'+i,text})),prerequisites:[]});
      else if(turn===2)reply('成员已派发，等待真实产物观察。');
      else if(turn===3)tool('manifest-goal-inspect','cbim_goal_inspect',{});
      else if(turn===4)tool('manifest-goal-review','cbim_goal_review',goalCompleteArguments(body,'manifest-goal-inspect'));
      else if(turn===5)reply(d.final);else throw Error('完整清单复核不应触发主模型：'+turn);
    }else{
      assert.ok(body.tools?.some(tool=>tool.function.name==='cbim_task_manifest_capture'));assert.ok(body.tools?.some(tool=>tool.function.name==='cbim_task_manifest_inspect'));
      if(turn===0)tool('manifest-task-plan','cbim_task_plan',{expectedVersion:0,goal:d.memberGoal,reason:'真实读取后完整观察目录',acceptance:d.acceptance,steps:[{id:'verify',title:'读取并记录完整产物',owner:'开发者'}]});
      else if(turn===1)tool('manifest-read','read',{path:d.file});
      else if(turn===2){assert.ok(JSON.stringify(body.messages).includes(d.content));tool('manifest-capture','cbim_task_manifest_capture',{expectedTaskProgressVersion:1})}
      else if(turn===3){
        const result=body.messages.find(message=>message.role==='tool'&&message.tool_call_id==='manifest-capture');assert.ok(result);const text=typeof result.content==='string'?result.content:Array.isArray(result.content)?result.content.map(item=>item&&typeof item==='object'&&'text' in item?String(item.text):'').join(''):'';
        let value=JSON.parse(text);if(Array.isArray(value.content))value=JSON.parse(value.content.filter((item:{type:string})=>item.type==='text').map((item:{text:string})=>item.text).join(''));assert.equal(value.state,'captured');assert.equal(typeof value.manifest?.manifestId,'string');assert.equal(value.manifest.entryCount,3);assert.equal(value.manifest.fileCount,1);assert.equal(value.manifest.snapshot,undefined);state.captured=value;
        emit({role:'assistant',content:'完整清单已保存，等待测试控制的结束边界。'});await gate;tool('manifest-step','cbim_task_step',{expectedVersion:1,id:'verify',state:'reported_done',evidenceIds:['manifest-read']});
      }else if(turn===4)tool('manifest-delivery','cbim_delivery_prepare',{expectedVersion:2,summary:'真实产物读取和完整集合已记录',limitations:['完整清单只表示声明范围内观察，不代替业务验收']});
      else if(turn===5)reply(d.final);else throw Error('完整清单查询不应重放成员：'+turn);
    }res.end('data: [DONE]\n\n');
  }catch(error){errors.push(String(error));if(!res.headersSent)res.writeHead(500);res.end('Output manifest fixture failed')}});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address!=='string');
  return {url:'http://127.0.0.1:'+address.port+'/v1',main,member,sequence,errors,state,bind:(agent:string,module:string,selection:OwnerExecutionSelection)=>{agentId=agent;moduleId=module;ownerSelection=structuredClone(selection)},releaseMember:()=>release(),close:async()=>{release();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}};
}
