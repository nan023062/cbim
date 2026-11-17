import {it,expect} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ToolTimeline} from '../../../../src/view/execution-view/ToolTimeline';
import type {RunSummary} from '../../../../src/bridge/contracts/execution';
it('a returned question remains waiting, then shows the original call resuming and completing',()=>{
 const run={status:'running',task:{workspaceId:'w'},events:[
  {type:'tool.allowed',data:{id:'call',name:'cbim_agent_call',input:{agentId:'worker'}}},
  {type:'tool.updated',data:{id:'call',name:'cbim_agent_call',agentCallState:'waiting'}},
  {type:'tool.finished',data:{id:'call',name:'cbim_agent_call',result:{status:'waiting'}}},
 ]} as unknown as RunSummary;
 const render=()=>renderToStaticMarkup(createElement(ToolTimeline,{run}));
 expect(render()).toContain('等待调用方答复');expect(render()).not.toContain('<span>已完成</span>');
 run.events.push({type:'tool.updated',data:{id:'call',name:'cbim_agent_call',agentCallState:'running'}} as any);
 expect(render()).toContain('<span>执行中</span>');
 run.events.push({type:'tool.updated',data:{id:'call',name:'cbim_agent_call',agentCallState:'completed',result:{status:'completed'}}} as any);
 run.status='completed';expect(render()).toContain('<span>已完成</span>');expect(render()).not.toContain('结果未核实');
});
