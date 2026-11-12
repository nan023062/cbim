import {expect,it,vi} from 'vitest';
import {FeedbackStatusTool} from '../src/backend/scheduler-engine/tools/feedback-status-tool';
import {authorizeRunTool,type RunToolDescriptor} from '../src/backend/core/tools/policy/tool-policy';
import type {FeedbackConnectionCheck} from '../src/backend/core/connectors/github-feedback';

const signal=()=>new AbortController().signal;
const read=async(tool:FeedbackStatusTool)=>JSON.parse((await tool.call('cbim_feedback_status',{},signal())).content[0].text);

it('distinguishes absent component, disconnected account and login after run preparation',async()=>{
  expect(await read(new FeedbackStatusTool('workspace',false))).toMatchObject({code:'FEEDBACK_TOOL_NOT_LOADED',submitAvailable:false,receiptAvailable:false});
  let connection:FeedbackConnectionCheck={code:'GITHUB_NOT_CONNECTED'};
  const oldRun=new FeedbackStatusTool('workspace',false,async()=>connection);
  expect(await read(oldRun)).toMatchObject({code:'GITHUB_NOT_CONNECTED',submitAvailable:false});
  connection={code:'GITHUB_AUTH_PENDING'};expect(await read(oldRun)).toMatchObject({code:'GITHUB_AUTH_PENDING',submitAvailable:false,receiptAvailable:false});
  connection={code:'GITHUB_CONNECTED',repository:{owner:'owner',repo:'repo'}};
  expect(await read(oldRun)).toMatchObject({code:'FEEDBACK_NEW_TURN_REQUIRED',submitAvailable:false,receiptAvailable:false});
  expect(await read(new FeedbackStatusTool('workspace',true,async()=>connection))).toMatchObject({code:'FEEDBACK_READY',submitAvailable:true,receiptAvailable:true,repository:connection.repository});
  connection={code:'GITHUB_CONNECTION_CHANGED',repository:{owner:'new-owner',repo:'repo'}};
  expect(await read(new FeedbackStatusTool('workspace',true,async()=>connection))).toMatchObject({code:'GITHUB_CONNECTION_CHANGED'});
});

it.each(['GITHUB_EXPIRED','GITHUB_SECRET_STORAGE','GITHUB_SETTINGS'] as const)('preserves diagnosed failure %s instead of pretending the account is disconnected',async code=>{
  expect(await read(new FeedbackStatusTool('workspace',true,async()=>({code})))).toMatchObject({code});
});

it('does not expose private exception content or accept status/target overrides',async()=>{
  const check=vi.fn(async()=>{throw Error('private-token-value')});const tool=new FeedbackStatusTool('workspace',false,check);
  for(const input of [{token:'secret'},{owner:'other'},{connected:true},{workspaceId:'other'}])await expect(tool.call('cbim_feedback_status',input,signal())).rejects.toMatchObject({code:'GITHUB_FEEDBACK_INPUT'});
  expect(check).not.toHaveBeenCalled();const result=await read(tool);expect(result.code).toBe('GITHUB_SETTINGS');expect(JSON.stringify(result)).not.toContain('private-token-value');
});

it('allows only the exact read-only status descriptor without granting external write or cross-workspace access',async()=>{
  const tool=new FeedbackStatusTool('workspace',false),descriptor=tool.describe('cbim_feedback_status',{}),call={id:'call',name:'cbim_feedback_status',input:{}};
  const context={workspaceId:'workspace',permission:'read' as const,guard:vi.fn(async()=>({allow:true})),approve:vi.fn(async()=>({allow:true}))};
  expect(await authorizeRunTool(call,descriptor,context)).toMatchObject({allow:true,effects:['read']});
  const altered:RunToolDescriptor[]=[{...descriptor,effects:['external-write']},{...descriptor,effects:['read','knowledge-write']},{...descriptor,native:true},{...descriptor,contractVersion:2},{...descriptor,scope:undefined},{...descriptor,scope:{kind:'workspace',workspaceId:'other'}}];
  for(const value of altered)expect(await authorizeRunTool(call,value,{...context,permission:'execute'})).toMatchObject({allow:false});
  for(const name of ['cbim_feedback_submit','cbim_feedback_receipt','cbim_feedback_forged'])expect(await authorizeRunTool({...call,name},descriptor,{...context,permission:'execute'})).toMatchObject({allow:false});
  expect(context.approve).not.toHaveBeenCalled();expect(context.guard).not.toHaveBeenCalled();
});
