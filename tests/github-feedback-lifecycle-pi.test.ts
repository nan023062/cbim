import {required} from './helpers';
import {expect,it,vi} from 'vitest';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import {fixture} from './helpers';
import {Application} from '../src/backend/main/application';
import {Paths} from '../src/backend/main/platform/paths';
import {knowledgeContractResult} from './knowledge-contract-provider';
import {transcript} from '../src/frontend/execution-view/transcript';
import type {RunSummary} from '../src/backend/core/brain/types';

it.each(['bug','wish'] as const)('refreshes both feedback tools after login when resuming an empty-project conversation (%s)',async kind=>{
  const f=await fixture();await f.app.shutdown();
  const cipher={available:()=>true,encrypt:(value:string)=>Buffer.from(value).toString('base64'),decrypt:(value:string)=>Buffer.from(value,'base64').toString()};
  const app=new Application(new Paths(f.user,path.resolve('.')),path.resolve('design'),cipher);await app.init();
  const entry=await app.dispatch('add',{path:f.a}),workspace=app.workspace(entry.id),before=await workspace.snapshot();
  const input=kind==='bug'?{kind,summary:'Lifecycle bug',steps:'User supplied step',actual:'User supplied error',expected:'Open normally',environment:'Windows fixture'}:{kind,summary:'Lifecycle wish',scenario:'User supplied scenario',problem:'User supplied problem',expected:'User supplied feature',example:'User supplied example'};
  const token='gho_lifecycle_fixture_token',issues:unknown[]=[],requests:any[]=[],errors:string[]=[];
  let phase:'unconnected'|'pending'|'connected'|'disconnected'='unconnected',step=0;
  const actualFetch=globalThis.fetch;
  vi.spyOn(globalThis,'fetch').mockImplementation(async(url,options)=>{
    const target=String(url);if(!target.startsWith('https://github.com/')&&!target.startsWith('https://api.github.com/'))return actualFetch(url,options);
    const response=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
    if(target.endsWith('/login/device/code'))return response({device_code:'private-fixture-code',user_code:'ABCD-EFGH',verification_uri:'https://github.com/login/device',expires_in:900,interval:1});
    if(target.endsWith('/login/oauth/access_token'))return response({access_token:token,token_type:'bearer',scope:'public_repo'});
    expect((options?.headers as any).Authorization).toBe('Bearer '+token);
    if(target.endsWith('/user'))return response({id:1,login:'tester'});
    if(target.endsWith('/repos/owner/repo'))return response({id:2,full_name:'owner/repo',has_issues:true,archived:false,private:false});
    if(target.endsWith('/issues')&&options?.method==='POST'){
      const body=JSON.parse(String(options.body)),issue={...body,number:1,html_url:'https://github.com/owner/repo/issues/1',url:'https://api.github.com/repos/owner/repo/issues/1',user:{id:1}};
      issues.push(issue);return response(issue,201);
    }
    throw Error('unexpected GitHub fixture endpoint');
  });
  const server=http.createServer(async(req,res)=>{try{
    let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);requests.push(body);
    const names=body.tools.map((tool:any)=>tool.function.name);
    assert.ok(names.includes('cbim_feedback_status'));
    assert.equal(names.includes('cbim_feedback_submit'),phase==='connected');
    assert.equal(names.includes('cbim_feedback_receipt'),phase==='connected');
    assert.ok(names.includes('bash')&&names.includes('write'));assert.ok(!raw.includes(token));
    res.writeHead(200,{'Content-Type':'text/event-stream'});
    const emit=(delta:unknown,finish_reason:string|null=null)=>res.write('data: '+JSON.stringify({id:'lifecycle-'+requests.length,object:'chat.completion.chunk',created:1,model:'feedback-lifecycle',choices:[{index:0,delta,finish_reason}]})+'\n\n');
    const tool=(id:string,name:string,args:unknown)=>{emit({role:'assistant',tool_calls:[{index:0,id,type:'function',function:{name,arguments:JSON.stringify(args)}}]});emit({},'tool_calls')};
    if(step===0)tool('lifecycle-status-'+phase,'cbim_feedback_status',{});
    else if(phase!=='connected'){assert.equal(knowledgeContractResult(body,'lifecycle-status-'+phase).code,phase==='pending'?'GITHUB_AUTH_PENDING':'GITHUB_NOT_CONNECTED');emit({role:'assistant',content:'Feedback connection is unavailable in this fixture phase.'});emit({},'stop')}
    else if(step===1){assert.equal(knowledgeContractResult(body,'lifecycle-status-connected').code,'FEEDBACK_READY');tool('lifecycle-skill','cbim_skill_'+(kind==='bug'?'bug_feedback':'feature_wish'),{workspaceId:entry.id,instanceId:workspace.instanceId})}
    else if(step===2){assert.ok(knowledgeContractResult(body,'lifecycle-skill').text.includes('cbim_feedback_submit'));tool('lifecycle-submit','cbim_feedback_submit',input)}
    else if(step===3){assert.equal(knowledgeContractResult(body,'lifecycle-submit').status,'submitted');tool('lifecycle-receipt','cbim_feedback_receipt',{})}
    else if(step===4){assert.equal(knowledgeContractResult(body,'lifecycle-receipt').status,'submitted');emit({role:'assistant',content:'Feedback submitted once; the original receipt is available.'});emit({},'stop')}
    else throw Error('unexpected extra model turn');
    step++;res.end('data: [DONE]\n\n');
  }catch(error){errors.push(String(error));if(!res.headersSent)res.writeHead(500);res.end('fixture error')}});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const address=server.address();assert.ok(address&&typeof address!=='string');
    await app.models.save({profile:{name:'Feedback lifecycle',api:'openai-completions',baseUrl:`http://127.0.0.1:${address.port}/v1`,auth:'none',defaultModel:'feedback-lifecycle',models:[{id:'feedback-lifecycle',name:'Feedback lifecycle',enabled:true,contextWindow:32768,maxTokens:1024,reasoning:false,pricing:{input:0,output:0,cacheRead:0,cacheWrite:0}}]}});
    const options={permission:'ask',turnTimeoutMs:60000};
    const wait=async(run:{taskId:string;runId:string})=>{let summary!:RunSummary;await vi.waitFor(async()=>{
      expect(errors).toEqual([]);summary=await app.dispatch('loop.inspect',{id:entry.id,taskId:run.taskId,runId:run.runId});expect(summary.status).toBe('completed');
      expect(app.runtime.snapshot().pressure.activeRuns).toBe(0);
    },{timeout:30000,interval:50});return summary};
    const first=await app.dispatch('loop.chat',{id:entry.id,message:'I want to submit feedback but have not connected GitHub yet.',options});await wait(first);
    const auth=await app.dispatch('github.feedback.begin',{clientId:'fixture_client',owner:'owner',repo:'repo',visibility:'public',autoSubmit:true});
    phase='pending';step=0;
    const pending=await app.dispatch('loop.resume',{id:entry.id,taskId:first.taskId,runId:first.runId,message:'Check the local authorization status before the settings page receives the token.',options});await wait(pending);
    expect(issues).toHaveLength(0);expect((await app.dispatch('github.feedback.status')).connected).toBeUndefined();
    await vi.waitFor(async()=>expect((await app.dispatch('github.feedback.poll',{flowId:required(auth.flow).id})).connected?.login).toBe('tester'),{timeout:4000,interval:100});
    phase='connected';step=0;
    const second=await app.dispatch('loop.resume',{id:entry.id,taskId:first.taskId,runId:pending.runId,message:'GitHub is now connected; submit this feedback: '+JSON.stringify(input),options});
    const submitted=await wait(second);
    expect(issues).toHaveLength(1);expect(submitted.toolReceipts?.filter(r=>r.toolName.startsWith('cbim_feedback_')).map(r=>r.outcome)).toEqual(['succeeded','succeeded','succeeded']);
    const manifest=submitted.events.find(event=>event.type==='engine.status'&&event.data.metric==='tool-catalog'&&event.data.stage==='active');
    expect(manifest?.data.missing).toEqual([]);expect(manifest?.data.active).toEqual(expect.arrayContaining(['cbim_feedback_status','cbim_feedback_submit','cbim_feedback_receipt']));
    expect(transcript(submitted).some(item=>item.kind==='assistant'&&item.text==='Feedback submitted once; the original receipt is available.')).toBe(true);
    await app.dispatch('github.feedback.disconnect');phase='disconnected';step=0;
    const third=await app.dispatch('loop.resume',{id:entry.id,taskId:first.taskId,runId:second.runId,message:'Check feedback availability after disconnecting.',options});await wait(third);
    expect(issues).toHaveLength(1);expect((await workspace.snapshot()).files).toEqual(before.files);
    expect((await app.dispatch('dispatch.graphSnapshot',{identity:{workspaceId:entry.id,rootSessionId:first.taskId}})).tasks).toEqual([]);
  }finally{vi.restoreAllMocks();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await app.shutdown();await f.cleanup()}
},90000);
