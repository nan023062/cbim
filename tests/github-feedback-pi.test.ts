import {required} from './support/assertions';
import {expect,it,vi} from 'vitest';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import {fixture} from './helpers';
import {Application} from '../src/bridge/server/application';
import {Paths} from '../src/logic/workspace/service/paths';
import {knowledgeContractResult} from './knowledge-contract-provider';
import {transcript} from '../src/frontend/execution-view/transcript';
import type {RunSummary} from '../src/logic/execution/rules/types';

it.each(['ask','read','unconnected'] as const)('real Pi main invokes feedback Skill and guarded submission (%s)',async mode=>{
  const f=await fixture();await f.app.shutdown();
  const cipher={available:()=>true,encrypt:(value:string)=>Buffer.from(value).toString('base64'),decrypt:(value:string)=>Buffer.from(value,'base64').toString()};
  const app=new Application(new Paths(f.user,path.resolve('.')),path.resolve('design'),cipher);await app.init();
  const entry=await app.dispatch('add',{path:f.a}),workspace=app.workspace(entry.id),before=await workspace.snapshot();
  const input={kind:'bug',summary:'安装后的桌面图标与启动后窗口图标不一致'};
  const token='gho_private_fixture_token',issues:unknown[]=[],requests:any[]=[],errors:string[]=[];const actualFetch=globalThis.fetch;
  vi.spyOn(globalThis,'fetch').mockImplementation(async(url,options)=>{
    const target=String(url);if(!target.startsWith('https://github.com/')&&!target.startsWith('https://api.github.com/'))return actualFetch(url,options);
    const response=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
    if(target.endsWith('/login/device/code'))return response({device_code:'private-device-code',user_code:'ABCD-EFGH',verification_uri:'https://github.com/login/device',expires_in:900,interval:1});
    if(target.endsWith('/login/oauth/access_token'))return response({access_token:token,token_type:'bearer',scope:'public_repo'});
    expect((options?.headers as any).Authorization).toBe('Bearer '+token);
    if(target.endsWith('/user'))return response({id:1,login:'tester'});
    if(target.endsWith('/repos/owner/repo'))return response({id:2,full_name:'owner/repo',has_issues:true,archived:false,private:false});
    if(target.endsWith('/issues')&&options?.method==='POST'){
      const body=JSON.parse(String(options.body)),issue={...body,number:1,html_url:'https://github.com/owner/repo/issues/1',url:'https://api.github.com/repos/owner/repo/issues/1',user:{id:1}};issues.push(issue);return response(issue,201);
    }
    throw Error('unexpected GitHub fixture endpoint');
  });
  const server=http.createServer(async(req,res)=>{try{
    let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw),turn=requests.length;requests.push(body);
    const names=body.tools.map((tool:any)=>tool.function.name);assert.ok(names.includes('cbim_skill_bug_feedback'));assert.equal(names.includes('cbim_feedback_submit'),mode!=='unconnected');assert.ok(['bash','write'].every(name=>names.includes(name)===(mode!=='read')));
    assert.ok(!raw.includes(token));
    res.writeHead(200,{'Content-Type':'text/event-stream'});const emit=(delta:unknown,finish_reason:string|null=null)=>res.write('data: '+JSON.stringify({id:'feedback-'+turn,object:'chat.completion.chunk',created:1,model:'feedback-fixture',choices:[{index:0,delta,finish_reason}]})+'\n\n');
    const tool=(id:string,name:string,args:unknown)=>{emit({role:'assistant',tool_calls:[{index:0,id,type:'function',function:{name,arguments:JSON.stringify(args)}}]});emit({},'tool_calls')};
    if(turn===0)tool('skill','cbim_skill_bug_feedback',{workspaceId:entry.id,instanceId:workspace.instanceId});
    else if(turn===1){const skill=knowledgeContractResult(body,'skill').text;assert.ok(skill.includes('cbim_feedback_submit'));assert.ok(skill.includes('只填写第一项就可以提交'));assert.ok(skill.includes('不要为填满字段反复追问'));if(mode==='unconnected'){emit({role:'assistant',content:'尚未连接，请先到设置连接 GitHub'});emit({},'stop')}else tool('submit','cbim_feedback_submit',input)}
    else if(turn===2){const result=knowledgeContractResult(body,'submit');if(mode==='ask'){assert.equal(result.status,'submitted');tool('duplicate-new-id','cbim_feedback_submit',input)}else{assert.ok(result.error||result.code||result.isError);emit({role:'assistant',content:'当前只读，尚未提交'});emit({},'stop')}}
    else if(turn===3&&mode==='ask'){assert.equal(knowledgeContractResult(body,'duplicate-new-id').status,'submitted');emit({role:'assistant',content:'FEEDBACK_SUBMITTED_NOT_IMPLEMENTED'});emit({},'stop')}
    else throw Error('unexpected extra model turn');
    res.end('data: [DONE]\n\n');
  }catch(error){errors.push(String(error));if(!res.headersSent)res.writeHead(500);res.end('fixture error')}});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    if(mode!=='unconnected'){
      const started=await app.dispatch('github.feedback.begin',{clientId:'fixture_client',owner:'owner',repo:'repo',visibility:'public',autoSubmit:true});
      await vi.waitFor(async()=>expect((await app.dispatch('github.feedback.poll',{flowId:required(started.flow).id})).connected?.login).toBe('tester'),{timeout:4000,interval:100});
    }
    const address=server.address();assert.ok(address&&typeof address!=='string');
    await app.models.save({profile:{name:'Feedback fixture',api:'openai-completions',baseUrl:`http://127.0.0.1:${address.port}/v1`,auth:'none',defaultModel:'feedback-fixture',models:[{id:'feedback-fixture',name:'Feedback fixture',enabled:true,contextWindow:32768,maxTokens:1024,reasoning:false,pricing:{input:0,output:0,cacheRead:0,cacheWrite:0}}]}});
    const started=await app.dispatch('loop.chat',{id:entry.id,message:'请按 BUG 反馈 Skill 提交以下用户上下文：'+JSON.stringify(input),options:{permission:mode==='read'?'read':'ask',turnTimeoutMs:60000}});
    let summary!:RunSummary;
    await vi.waitFor(async()=>{expect(errors).toEqual([]);summary=await app.dispatch('loop.inspect',{id:entry.id,taskId:started.taskId,runId:started.runId});expect(summary.status).toBe('completed')},{timeout:30000,interval:50});
    expect(await app.dispatch('loop.approvals',{id:entry.id,taskId:started.taskId})).toEqual([]);expect(issues).toHaveLength(mode==='ask'?1:0);expect(JSON.stringify(summary)).not.toContain(token);
    const receipts=summary.toolReceipts?.filter(receipt=>receipt.toolName==='cbim_feedback_submit')??[];
    if(mode==='ask'){
      expect(String((issues[0] as any).body).match(/用户未提供/g)).toHaveLength(4);expect(await app.dispatch('loop.questions',{id:entry.id,taskId:started.taskId})).toEqual([]);
      expect(receipts).toHaveLength(2);for(const receipt of receipts)expect(receipt).toMatchObject({outcome:'succeeded',effects:['external-write'],scope:{kind:'github-feedback',workspaceId:entry.id,owner:'owner',repo:'repo',repositoryId:2}});
      expect(transcript(summary).some(item=>item.kind==='assistant'&&item.text.includes('FEEDBACK_SUBMITTED_NOT_IMPLEMENTED'))).toBe(true);
    }else if(mode==='read'){expect(receipts[0].outcome).toBe('denied');expect(transcript(summary).some(item=>item.text==='当前只读，尚未提交')).toBe(true)}else expect(receipts).toEqual([]);
    expect((await workspace.snapshot()).files).toEqual(before.files);expect((await app.dispatch('dispatch.graphSnapshot',{identity:{workspaceId:entry.id,rootSessionId:started.taskId}})).tasks).toEqual([]);
  }finally{vi.restoreAllMocks();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await app.shutdown();await f.cleanup()}
},60000);
