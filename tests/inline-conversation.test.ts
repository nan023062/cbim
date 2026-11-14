import {expect,it} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {transcript} from '../src/view/execution-view/transcript';
import {inlineDependencies,inlineDispatchedTask,inlineHandoffTasks} from '../src/view/conversation/inline-task-state';
import {ToolActivity} from '../src/view/tasks/ToolActivity';
import {MemberActivityCard} from '../src/view/tasks/MemberActivity';
import {WorkStatus} from '../src/view/execution-view/WorkStatus';
import {ConversationTurn} from '../src/view/conversation/ConversationTurn';
import {inlineMainRuns} from './inline-conversation-fixture';
import {progressFixture} from './conversation-progress-fixture';
import {ToolTimeline} from '../src/view/execution-view/ToolTimeline';

it('失败轨道显示核实建议，熔断提示不输出 undefined，也不提供重试动作',()=>{
 const run=structuredClone(inlineMainRuns(2)[0]);
 const tool=run.events.find(event=>event.type==='tool.finished')!;
 tool.data.isError=true;tool.data.outcome={status:'unknown',nextStep:'先核实原结果，不自动重试。'};
 run.events.push({...tool,seq:999,type:'engine.status',data:{state:'blocked',message:'同一工具连续失败三次，已停止本轮'}});
 const html=renderToStaticMarkup(createElement(ToolTimeline,{run}));
 expect(html).toContain('先核实原结果，不自动重试');expect(html).toContain('同一工具连续失败三次');expect(html).not.toContain('undefined');expect(html).not.toContain('button');
});

it('文字、单次工具生命周期和后续文字按首次出现顺序保留，重读幂等',()=>{
  const run=inlineMainRuns(2)[0],before=JSON.stringify(run),items=transcript(run);
  expect(items.map(x=>x.kind)).toEqual(['user','assistant','tool','tool','assistant','tool','assistant']);
  expect(items.filter(x=>x.toolCallId==='dispatch-member-1')).toHaveLength(1);
  expect(items[3].text).toContain('tool.finished');expect(items[1].time).toBe(run.events[1].time);
  expect(transcript(JSON.parse(before))).toEqual(items);expect(JSON.stringify(run)).toBe(before);
});
it('已完成回复后的流式文本独立追加；最终消息替换本段',()=>{
  const run=inlineMainRuns(0)[0],base=run.events[0];
  run.events.push({...base,seq:3,type:'message',data:{text:'先分析棋子'}},{...base,seq:4,type:'tool.started',data:{id:'tool',name:'read'}},{...base,seq:5,type:'message.delta',data:{text:'新段'}},{...base,seq:6,type:'message',data:{text:'新段最终'}});
  expect(transcript(run).map(x=>x.text).filter(x=>!x.startsWith('{'))).toEqual(['实现网页版中国象棋','先分析棋子','新段最终']);
  expect(transcript(run)[1].pending).toBe(false);
});
it('跨 HTTP/stdout 到达的门禁不抢在所属回复前，增量被原完整回复替换且旧轮次不重排',()=>{
  const run=inlineMainRuns(0)[0],base=run.events[0];run.events=[base,
    {...base,seq:2,type:'tool.proposed',data:{id:'early',name:'read'}},
    {...base,seq:3,type:'message.delta',data:{text:'先核实'}},
    {...base,seq:4,type:'tool.allowed',data:{id:'early',name:'read'}},
    {...base,seq:5,type:'message',data:{text:'先核实文件。',toolCallIds:['early']}},
    {...base,seq:6,type:'tool.finished',data:{id:'early',name:'read',result:'文件内容'}},
    {...base,seq:7,type:'message',data:{text:'核实结束',toolCallIds:['early']}},
  ];
  const items=transcript(run);expect(items.map(i=>i.kind)).toEqual(['user','assistant','tool','assistant']);expect(items[1].text).toBe('先核实文件。');expect(items[3].text).toBe('核实结束');
  delete run.events[4].data.toolCallIds;expect(transcript(run).map(i=>i.kind)).toEqual(['user','tool','assistant','assistant']);
});
it('派发关联严格成功回执与同流图，候选和等待更新原节点',()=>{
  const run=inlineMainRuns(2)[0];
  for(const phase of [2,3,4,5,6]){const {graph}=progressFixture(phase);expect(inlineDispatchedTask(run,'dispatch-member-1',graph)).toBe(graph.tasks[0])}
  const {graph}=progressFixture(2);expect(inlineDispatchedTask(run,'plan',graph)).toBeUndefined();
  const noRead=renderToStaticMarkup(createElement(MemberActivityCard,{...graph.identity,task:graph.tasks[1],active:true,inline:true,onSelectTask:()=>{}}));
  expect(noRead).toContain('等待前置任务');expect(noRead).not.toContain('正在读取成员动态');expect(noRead).toContain('展开成员过程');
});
it('错误、未知、旧日志、跨运行/工作区/会话/图流与未追齐游标都不拼接任务',()=>{
  const original=inlineMainRuns(2)[0],originalGraph=progressFixture(2).graph;
  const changes=[
    (r:any)=>{r.conversationBinding=undefined},(r:any)=>{r.task.agentId='other'},(r:any)=>{r.memberBinding={}},
    (r:any,g:any)=>{g.identity.rootSessionId='other'},(r:any,g:any)=>{g.cursor.streamId='new'},(r:any,g:any)=>{g.cursor.seq=2},
    (r:any,g:any)=>{g.root.agent.agentInstanceId='other'},(r:any,g:any,e:any)=>{e.data.receipt.scope.workspaceId='other'},
    (r:any,g:any)=>{g.tasks[0].identity.workspaceId='other'},(r:any,g:any)=>{g.tasks.push(g.tasks[0])},
    (r:any,g:any,e:any)=>{e.data.isError=true},(r:any,g:any,e:any)=>{e.runId='other'},(r:any,g:any,e:any)=>{e.data.receipt.outcome='unknown'},
    (r:any,g:any,e:any)=>{e.data.receipt.toolCallId='other'},(r:any,g:any,e:any)=>{e.data.receipt.workspaceId='other'},
    (r:any,g:any,e:any)=>{e.data.receipt.runId='other'},(r:any,g:any,e:any)=>{e.data.receipt.taskId='other'},
    (r:any,g:any,e:any)=>{e.data.receipt=undefined},(r:any,g:any,e:any)=>{e.data.result.content[0].text='not JSON'},
    (r:any,g:any,e:any)=>{const data=JSON.parse(e.data.result.content[0].text);data.cursor.rootSessionId='other';e.data.result.content[0].text=JSON.stringify(data)},
  ];
  for(const change of changes){const r=structuredClone(original),g=structuredClone(originalGraph),e=r.events.find(e=>e.type==='tool.finished'&&e.data.id==='dispatch-member-1')!;change(r,g,e);expect(inlineDispatchedTask(r,'dispatch-member-1',g)).toBeUndefined()}
});
it('前置接收只根据边回执，不根据候选存在或模型文字推断',()=>{
  const f=progressFixture(4);expect(inlineDependencies(f.graph.tasks[1],f.graph)[0]).toMatchObject({received:true});
  const edge=f.graph.edges.find(e=>e.kind==='dependency')!;if(edge.kind==='dependency')delete edge.condition.resultId;
  expect(f.graph.tasks[0].result).toBeDefined();expect(inlineDependencies(f.graph.tasks[1],f.graph)[0]).toMatchObject({received:false});
});
it('系统交接只导航原任务，不合成用户消息或新的工具执行',()=>{
  const run=inlineMainRuns(4)[1],{graph}=progressFixture(4);expect(inlineHandoffTasks(run,graph).map(t=>t.taskId)).toEqual(['member-1']);
  expect(transcript(run).map(i=>i.kind)).toEqual(['system','assistant']);run.source=undefined;delete run.events[0].data.source;expect(inlineHandoffTasks(run,graph)).toEqual([]);
});
it('单工具模式保留失败证据与原核实入口，状态尾行不重复调用',()=>{
  const run=inlineMainRuns(2)[0],html=renderToStaticMarkup(createElement(ToolActivity,{run,toolCallId:'dispatch-member-1'}));
  expect(html).toContain('data-tool-call-id="dispatch-member-1"');expect(html).not.toContain('data-tool-call-id="dispatch-member-2"');expect(html).toContain('原命令');
  const footer=renderToStaticMarkup(createElement(WorkStatus,{run,now:0,inline:true}));expect(footer).toContain('本轮结束');expect(footer).not.toContain('<details');expect(footer).not.toContain('data-tool-call-id');
});

it('没有最终正文的已结束主对话在流中显示记录反馈，运行中不提前展示',()=>{
  const run=inlineMainRuns(0)[0];run.events=[run.events[0]];run.status='completed';
  const render=()=>renderToStaticMarkup(createElement(ConversationTurn,{run,workspaceId:run.task.workspaceId,now:0,recovery:{state:{}} as any,active:false,onSelectTask:()=>{}}));
  expect(render()).toContain('aria-label="本轮反馈（运行记录）"');expect(render()).toContain('未记录 Agent 的最终反馈');
  run.status='running';expect(render()).not.toContain('aria-label="本轮反馈（运行记录）"');
});
