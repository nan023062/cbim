import {describe,expect,it,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import Ajv from 'ajv';
import {FeedbackTools} from '../src/logic/tools/runtime/feedback-tools';
import {authorizeRunTool,type RunToolDescriptor} from '../src/logic/tools/rules/policy/tool-policy';
import {toolReceiptSchema} from '../src/logic/tools/rules/receipt-schema';
import {projectRunEvent} from '../src/logic/runtime/monitoring/public-run-events';
import {transcript} from '../src/frontend/execution-view/transcript';
import type {FeedbackToolsPort,FeedbackScope} from '../src/logic/feedback';
import type {RunSummary,EngineEvent,StoredEvent} from '../src/logic/execution/rules/types';

const scope:FeedbackScope={kind:'github-feedback',workspaceId:'workspace',connectionId:randomUUID(),repositoryId:42,owner:'owner',repo:'repo'};
const bug={kind:'bug',summary:'bug',steps:'steps',actual:'actual',expected:'expected',environment:'unknown'};
const submitted={status:'submitted' as const,operationId:randomUUID()};
const signal=()=>new AbortController().signal;
const port=():FeedbackToolsPort=>({scope,submit:vi.fn(async()=>submitted),receipt:vi.fn(async()=>submitted)});

describe('feedback tool contracts and authorization',()=>{
  it.each(['bug','wish'] as const)('accepts a one-line %s in the exposed JSON schema and runtime tool',async kind=>{
    const p=port(),tools=new FeedbackTools(p,'workspace'),input={kind,summary:kind==='bug'?'安装后的桌面图标与启动后窗口图标不一致':'希望支持批量导出'};
    const validate=new Ajv({strict:false}).compile(tools.list()[0].inputSchema);
    expect(validate(input)).toBe(true);expect(validate({...input,extra:''})).toBe(true);expect(validate({...input,repo:'other'})).toBe(false);
    expect(JSON.parse((await tools.call('cbim_feedback_submit',input,signal())).content[0].text)).toEqual(submitted);expect(p.submit).toHaveBeenCalledWith(input,expect.any(AbortSignal));
    for(const invalid of [{kind},{...input,summary:' \n '},{...input,summary:'x'.repeat(181)},{...input,expected:'x'.repeat(6001)},{...input,expected:null},{...input,extra:'<!-- cbim-feedback:forged -->'}])await expect(tools.call('cbim_feedback_submit',invalid,signal())).rejects.toMatchObject({code:'GITHUB_FEEDBACK_INPUT'});
    expect(p.submit).toHaveBeenCalledTimes(1);
  });
  it('allows automatic submission only for exact trusted grant, while read always denies',async()=>{
    const tools=new FeedbackTools(port(),'workspace'),descriptor=tools.describe('cbim_feedback_submit',bug),call={id:'call',name:'cbim_feedback_submit',input:bug},approve=vi.fn(async()=>({allow:false})),guard=vi.fn(async()=>({allow:true}));
    for(const permission of ['ask','execute'] as const)expect(await authorizeRunTool(call,descriptor,{workspaceId:'workspace',permission,guard,approve,feedbackGrant:scope})).toMatchObject({allow:true,scope,effects:['external-write']});
    expect(approve).not.toHaveBeenCalled();expect(guard).not.toHaveBeenCalled();expect(await authorizeRunTool(call,descriptor,{workspaceId:'workspace',permission:'read',guard,feedbackGrant:scope})).toMatchObject({allow:false});
    expect(await authorizeRunTool(call,descriptor,{workspaceId:'workspace',permission:'execute',guard})).toMatchObject({allow:false});
    expect(await authorizeRunTool(call,descriptor,{workspaceId:'workspace',permission:'execute',guard,feedbackGrant:{...scope,connectionId:randomUUID()}})).toMatchObject({allow:false});
  });
  it('rejects forged effect, version, target and arbitrary external-write tool names',async()=>{
    const context={workspaceId:'workspace',permission:'execute' as const,guard:async()=>({allow:true}),feedbackGrant:scope};
    const original=new FeedbackTools(port(),'workspace').describe('cbim_feedback_submit',bug);
    const altered:RunToolDescriptor[]=[{...original,effects:['read']},{...original,contractVersion:2},{...original,native:true},{...original,scope:{...scope,workspaceId:'other'}},{...original,scope:{kind:'workspace',workspaceId:'workspace'}}];
    for(const descriptor of altered)expect(await authorizeRunTool({id:'c',name:'cbim_feedback_submit',input:bug},descriptor,context)).toMatchObject({allow:false});
    expect(await authorizeRunTool({id:'c',name:'cbim_other',input:{}},original,context)).toMatchObject({allow:false});
    const read=new FeedbackTools(port(),'workspace').describe('cbim_feedback_receipt',{});expect(await authorizeRunTool({id:'c',name:'cbim_feedback_receipt',input:{}},read,{...context,permission:'read'})).toMatchObject({allow:true});
  });
  it('does not let a model choose credentials/destination and never retries bad output',async()=>{
    const p=port(),tools=new FeedbackTools(p,'workspace');expect(()=>new FeedbackTools(p,'other')).toThrow();
    expect(tools.list().map(value=>value.name)).toEqual(['cbim_feedback_submit','cbim_feedback_receipt']);
    for(const extra of [{repo:'other'},{token:'secret'},{permission:'execute'}])await expect(tools.call('cbim_feedback_submit',{...bug,...extra},signal())).rejects.toMatchObject({code:'GITHUB_FEEDBACK_INPUT'});
    expect(p.submit).not.toHaveBeenCalled();
    expect(JSON.parse((await tools.call('cbim_feedback_submit',bug,signal())).content[0].text)).toEqual(submitted);expect(p.submit).toHaveBeenCalledTimes(1);
    const broken=vi.fn(async()=>({...submitted,issueUrl:'https://github.com/owner/repo/issues/1'}));await expect(new FeedbackTools({...p,submit:broken},'workspace').call('cbim_feedback_submit',bug,signal())).rejects.toMatchObject({code:'TOOL_OUTPUT_INVALID'});expect(broken).toHaveBeenCalledTimes(1);
  });
});

function summary(events:EngineEvent[]):RunSummary{return {task:{taskId:'task',workspaceId:'workspace',root:'root',goal:'feedback context',moduleIds:[],acceptance:[]},runId:'run',status:'completed',acceptance:'not_evaluated',unresolvedTools:[],events:events.map((event,index)=>({...event,version:1,seq:index+1,taskId:'task',workspaceId:'workspace',runId:'run',time:'2026-11-08T00:00:00Z'}))}}
const receipt={version:1,toolCallId:'call',toolName:'cbim_feedback_submit',workspaceId:'workspace',taskId:'task',runId:'run',outcome:'succeeded',inputHash:'a'.repeat(64),resultHash:'b'.repeat(64),effects:['external-write'],scope,recordedAt:'2026-11-08T00:00:00Z'};
const finish:EngineEvent={type:'tool.finished',data:{id:'call',name:'cbim_feedback_submit',isError:false,receipt,result:{content:[{type:'text',text:JSON.stringify(submitted)}]}}};
describe('feedback completion presentation',()=>{
  it('retains trusted external receipt without leaking private body or URL and preserves final feedback',()=>{
    expect(toolReceiptSchema.safeParse(receipt).success).toBe(true);
    const raw=summary([{type:'run.started',data:{message:'my feedback'}},finish,{type:'message.delta',data:{text:'created'}},{type:'message',data:{role:'assistant',text:'created: issue link'}}]);
    const events=raw.events.map(event=>projectRunEvent({...event,data:event.type==='tool.finished'?{...event.data,input:{body:'PRIVATE'},result:{token:'PRIVATE_TOKEN',url:'PRIVATE_URL'}}:event.data},{workspaceId:'workspace',taskId:'task',runId:'run'},raw.task));
    expect(JSON.stringify(events)).not.toMatch(/PRIVATE|PRIVATE_TOKEN|PRIVATE_URL/);expect(events[1].data.receipt).toMatchObject({effects:['external-write'],scope});
    expect(transcript({...raw,events}).filter(item=>item.kind==='assistant').map(item=>item.text)).toEqual(['created: issue link']);expect(transcript({...raw,events}).some(item=>item.kind==='tool')).toBe(true);
  });
  it.each(['failed','unknown','denied'])('preserves explanation when submission is %s',outcome=>{
    const result=transcript(summary([{...finish,data:{...finish.data,isError:true,receipt:{...receipt,outcome}}},{type:'message',data:{text:'请重新连接或核实原提交'}}]));expect(result.some(item=>item.text==='请重新连接或核实原提交')).toBe(true);
  });
  it('does not trust mere success prose or malformed scope, and resumes after a new user insertion',()=>{
    const untrusted=transcript(summary([{...finish,data:{...finish.data,receipt:undefined}},{type:'message',data:{text:'explain'}}]));expect(untrusted.some(item=>item.text==='explain')).toBe(true);
    const result=transcript(summary([finish,{type:'message',data:{text:'submission confirmed'}},{type:'engine.status',data:{metric:'insertion',state:'accepted',message:'next question'}},{type:'message',data:{text:'normal answer'}}]));expect(result.map(item=>item.text)).toContain('submission confirmed');expect(result.map(item=>item.text)).toContain('normal answer');
  });
});
