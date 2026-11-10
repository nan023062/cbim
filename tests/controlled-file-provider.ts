import assert from 'node:assert/strict';
import http from 'node:http';
import {createHash} from 'node:crypto';
import type {OwnerExecutionSelection} from '../src/backend/core/team/member-execution-binding';
import {goalCompleteArguments,goalInspection,goalPlanArguments,type GoalFixtureRequest} from './goal-provider-fixture';
import {mainToolValue} from './main-tool-contract-provider';

export type ControlledFileMode='complete'|'bad-wire'|'partial'|'stop-before'|'ask-denied';
export const controlledFileFixture={
  model:'controlled-file-fixture',goal:'CONTROLLED_FILE: 受控替换现有文件并重新读取验证当前成果',
  memberGoal:'CONTROLLED_FILE_MEMBER: 根据真实基线替换现有JSON，独立读取并验证后交付',
  otherGoal:'CONTROLLED_FILE_OTHER: 独立会话仅回答，不参与原文件或补偿',
  file:'controlled-result.json',requirementId:'controlled-json',
  before:'{"state":"original-long-value","count":1000}\r\n',after:'{"state":"new","count":2}\n',
  changed:'{"state":"external-change","count":9}\n',
  acceptance:['使用实际文件基线完成受控替换，再以本轮真实读取和结构验证提交候选'],
  draft:'普通草稿保留；补偿是独立文件操作，不代表重新验收旧目标。',
  schema:{type:'object',required:['state','count'],properties:{state:{type:'string',minLength:1},count:{type:'integer',minimum:1}},additionalProperties:false},
};
type Request=GoalFixtureRequest&{model:string;tools?:{function:{name:string}}[]};
export const controlledFact=(text:string)=>({byteLength:Buffer.byteLength(text,'utf8'),sha256:createHash('sha256').update(text,'utf8').digest('hex')});

/** 本机供应商只返回计划和工具参数；before 条件取实际 capture 回执，绝不自行补造操作记录。 */
export async function controlledFileProvider(mode:ControlledFileMode='complete',adversarial=false){
  if(adversarial)assert.ok(mode==='partial'||mode==='bad-wire');
  const d=controlledFileFixture,main:Request[]=[],member:Request[]=[],other:Request[]=[],errors:string[]=[];
  let agentId='',moduleId='',ownerSelection:OwnerExecutionSelection|undefined;
  const state:{beforeCapture?:any;writeResult?:any;progress?:any;afterCapture?:any;validation?:any;step?:any;delivery?:any;observedText?:string}={};
  const server=http.createServer(async(req,res)=>{try{
    assert.equal(req.method,'POST');assert.ok(req.url?.endsWith('/chat/completions'));let raw='';for await(const chunk of req)raw+=chunk;
    const body=JSON.parse(raw)as Request;assert.equal(body.model,d.model);
    const auxiliary=JSON.stringify(body.messages).includes(d.otherGoal),isMain=body.tools?.some(item=>item.function.name==='cbim_dispatch_task')===true;
    const list=auxiliary?other:isMain?main:member,turn=list.length;list.push(body);
    res.writeHead(200,{'Content-Type':'text/event-stream'});
    const emit=(delta:unknown,finish_reason:string|null=null)=>res.write('data: '+JSON.stringify({id:'controlled-'+(main.length+member.length+other.length),object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta,finish_reason}]})+'\n\n');
    const tool=(id:string,name:string,args:unknown)=>{assert.ok(body.tools?.some(item=>item.function.name===name),'真实运行必须提供工具 '+name);emit({role:'assistant',tool_calls:[{index:0,id,type:'function',function:{name,arguments:JSON.stringify(args)}}]});emit({},'tool_calls')};
    const reply=(content:string,finish='stop')=>{emit({role:'assistant',content});emit({},finish)};
    const denied=(id:string)=>assert.match(JSON.stringify(mainToolValue(body,id)),/CONTROLLED_FILE_REVIEW_REQUIRED/);
    if(auxiliary){assert.equal(turn,0);reply('独立主会话没有读取、恢复或重放原文件操作。')}
    else if(isMain){
      assert.ok(body.tools?.every(item=>!['cbim_file_write_controlled'].includes(item.function.name)));
      assert.ok(ownerSelection);
      if(turn===0)tool('controlled-goal-plan','cbim_goal_plan',goalPlanArguments({objective:d.goal,agentId,moduleIds:[moduleId],ownerSelection,acceptance:d.acceptance}));
      else if(turn===1)tool('controlled-dispatch','cbim_dispatch_task',{agentId,moduleIds:[moduleId],ownerSelection,goal:d.memberGoal,acceptance:d.acceptance.map((text,index)=>({id:'criterion-'+index,text})),prerequisites:[]});
      else if(turn===2)reply('正式成员将先读取与采集真实文件，再执行唯一受控替换。');
      else if(turn===3)tool('controlled-goal-inspect','cbim_goal_inspect',{});
      else if(turn===4){
        if(mode==='complete')tool('controlled-goal-review','cbim_goal_review',goalCompleteArguments(body,'controlled-goal-inspect'));
        else {const {scope}=goalInspection(body,'controlled-goal-inspect');tool('controlled-goal-review','cbim_goal_review',{expectedRevision:scope.goal.revision,decision:'blocked',checks:scope.goal.plan.criteria.map(criterion=>({criterionId:criterion.id,outcome:'unmet',reason:'原文件操作没有可消费的完整交付证据，不以账本状态冒充业务完成',evidence:[]})),superseded:[],gaps:['保留原文件影响及原工具错误；只读核实后由用户明确决定'],reason:'本轮不重试受控写，不凭当前文件推断原操作终态'})}
      }else if(turn===5)reply(mode==='complete'?'实际当前读取与结构验证已通过，形成业务候选及主审阅。':'原目标未完成，原工具和文件操作事实保持独立。');
      else throw Error('Unexpected controlled main replay '+turn);
    }else{
      assert.ok(body.tools?.every(item=>!item.function.name.startsWith('cbim_dispatch_')&&!item.function.name.startsWith('cbim_goal_')));
      if(turn===0)tool('controlled-member-plan','cbim_task_plan',{expectedVersion:0,goal:d.memberGoal,acceptance:d.acceptance,reason:'实际读文件取得基线，受控替换后重新取证',steps:[{id:'verify',title:'受控替换并验证当前JSON',owner:'开发者'}]});
      else if(turn===1)tool('controlled-before-read','read',{path:d.file});
      else if(turn===2)tool('controlled-before-capture','cbim_task_artifact_capture',{expectedTaskProgressVersion:1,sourceToolCallIds:['controlled-before-read']});
      else if(turn===3){
        state.beforeCapture=mainToolValue(body,'controlled-before-capture');assert.equal(state.beforeCapture.state,'captured');
        const files=state.beforeCapture.baseline.files as Array<{relativePath:string;byteLength:number;sha256:string;sourceToolCallIds:string[]}>;
        assert.equal(files.length,1);assert.equal(files[0].relativePath,d.file);assert.deepEqual(files[0].sourceToolCallIds,['controlled-before-read']);
        const expectedBefore={byteLength:files[0].byteLength,sha256:files[0].sha256};assert.deepEqual(expectedBefore,controlledFact(d.before));
        tool('controlled-write','cbim_file_write_controlled',{path:d.file,expectedBefore,content:d.after});
      }else if(turn===4){
        state.writeResult=mainToolValue(body,'controlled-write');
        if(mode!=='complete'){
          assert.notEqual(state.writeResult.state,'applied','故障模式不能收到正常成功输出');
          if(mode==='bad-wire')assert.match(JSON.stringify(state.writeResult),/TOOL_OUTPUT_INVALID/);
          if(adversarial)tool('controlled-recheck-read','read',{path:d.file});
          else reply('受控调用没有可靠工具成功回执，不重复写入、不生成交付候选。','length');
        }else{
          assert.equal(state.writeResult.state,'applied');assert.equal(state.writeResult.operation.relativePath,d.file);assert.deepEqual(state.writeResult.operation.before,controlledFact(d.before));assert.deepEqual(state.writeResult.operation.after,controlledFact(d.after));
          tool('controlled-after-inspect','cbim_task_inspect',{});
        }
      }else if(adversarial){
        if(turn===5){
          const response=body.messages.find(item=>item.role==='tool'&&item.tool_call_id==='controlled-recheck-read');assert.ok(response);
          let text=typeof response.content==='string'?response.content:Array.isArray(response.content)?response.content.map(item=>item&&typeof item==='object'&&'text'in item?String(item.text):'').join(''):'';
          try{const wire=JSON.parse(text);if(Array.isArray(wire.content))text=wire.content.filter((item:{type:string})=>item.type==='text').map((item:{text:string})=>item.text).join('')}catch{/* 原文件文本保留换行 */}
          assert.equal(text,mode==='bad-wire'?d.after:d.after+d.before.slice(d.after.length));state.observedText=text;
          tool('controlled-recheck-inspect','cbim_task_inspect',{});
        }else if(turn===6){state.progress=mainToolValue(body,'controlled-recheck-inspect');assert.ok(state.progress.plan.version>1);tool('controlled-bypass-controlled','cbim_file_write_controlled',{path:d.file,expectedBefore:controlledFact(state.observedText!),content:'FORBIDDEN_CONTROLLED_WRITE'})}
        else if(turn===7){denied('controlled-bypass-controlled');tool('controlled-bypass-write','write',{path:d.file,content:'FORBIDDEN_NATIVE_WRITE'})}
        else if(turn===8){denied('controlled-bypass-write');tool('controlled-bypass-edit','edit',{path:d.file,edits:[{oldText:'"state":"new"',newText:'"state":"FORBIDDEN_EDIT"'}]})}
        else if(turn===9){denied('controlled-bypass-edit');tool('controlled-bypass-bash','bash',{command:'printf FORBIDDEN_COMMAND > '+d.file})}
        else if(turn===10){denied('controlled-bypass-bash');tool('controlled-bypass-delivery','cbim_delivery_prepare',{expectedVersion:state.progress.plan.version,summary:'试图绕过原受控写待核实屏障',limitations:[]})}
        else if(turn===11){denied('controlled-bypass-delivery');tool('controlled-unsafe-help','cbim_task_help',{kind:'capability',reason:'原写没有可靠工具成功回执，需要独立核实',question:'请保留原任务和文件事实，安排只读核实',attemptedToolCallIds:['controlled-write']})}
        else if(turn===12){assert.equal(mainToolValue(body,'controlled-unsafe-help').state,'staged');reply('已记录求助，但原写待核实，不能将本轮当作安全交接。')}
        else throw Error('Unexpected adversarial member replay '+turn);
      }else if(turn===5){state.progress=mainToolValue(body,'controlled-after-inspect');assert.ok(state.progress.plan.version>1);assert.ok(state.progress.evidence.every((item:{toolCallId:string})=>item.toolCallId!=='controlled-before-read'));tool('controlled-after-read','read',{path:d.file})}
      else if(turn===6)tool('controlled-after-capture','cbim_task_artifact_capture',{expectedTaskProgressVersion:state.progress.plan.version,sourceToolCallIds:['controlled-after-read']});
      else if(turn===7){state.afterCapture=mainToolValue(body,'controlled-after-capture');assert.equal(state.afterCapture.state,'captured');tool('controlled-validation','cbim_validation_run',{moduleId,requirementId:d.requirementId,baselineId:state.afterCapture.baseline.baselineId,expectedTaskProgressVersion:state.progress.plan.version})}
      else if(turn===8){state.validation=mainToolValue(body,'controlled-validation');assert.equal(state.validation.validation.outcome,'passed');tool('controlled-step','cbim_task_step',{expectedVersion:state.progress.plan.version,id:'verify',state:'reported_done',evidenceIds:['controlled-after-read','controlled-validation']})}
      else if(turn===9){state.step=mainToolValue(body,'controlled-step');tool('controlled-delivery','cbim_delivery_prepare',{expectedVersion:state.step.version,summary:'受控替换后的当前JSON已实际读取和结构验证',limitations:['文件操作 applied 与结构合格均不替代人工业务语义验收']})}
      else if(turn===10){state.delivery=mainToolValue(body,'controlled-delivery');assert.equal(state.delivery.state,'awaiting_review');reply('提交本轮读取与结构验证候选，不借旧读取或补偿记录作为交付。')}
      else throw Error('Unexpected controlled member replay '+turn);
    }
    res.end('data: [DONE]\n\n');
  }catch(error){errors.push(String(error));if(!res.headersSent)res.writeHead(500);res.end('Controlled file fixture failed')}});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address!=='string');
  return {url:`http://127.0.0.1:${address.port}/v1`,mode,main,member,other,errors,state,bind:(agent:string,module:string,selection:OwnerExecutionSelection)=>{agentId=agent;moduleId=module;ownerSelection=structuredClone(selection)},close:async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}};
}
