import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {RunInactivityTimer} from '../src/logic/execution/engines/run-inactivity';
import {PiEngine} from '../src/logic/execution/engines/pi/engine';
import {CodexEngine} from '../src/logic/execution/engines/codex/engine';
import {ClaudeCodeEngine} from '../src/logic/execution/engines/claude/engine';

beforeEach(()=>vi.useFakeTimers());
afterEach(()=>vi.useRealTimers());

it('默认窗口为连续静默30分钟，进展可让整轮运行超过旧上限，释放后迟到事件不复活',async()=>{
  const expired=vi.fn(),timer=new RunInactivityTimer(undefined,'Pi',expired);
  for(let i=0;i<4;i++){await vi.advanceTimersByTimeAsync(20*60*1000);timer.progress()}
  expect(expired).not.toHaveBeenCalled();await vi.advanceTimersByTimeAsync(30*60*1000);
  expect(expired).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({message:expect.stringContaining('30 分钟无执行进展')}));
  timer.progress();timer.dispose();await vi.advanceTimersByTimeAsync(60*60*1000);expect(expired).toHaveBeenCalledTimes(1);expect(vi.getTimerCount()).toBe(0);
});

it('状态通知、空增量及重复工具快照不能续期，工具新输出与终态可以续期',async()=>{
  const expired=vi.fn(),timer=new RunInactivityTimer(1000,'Pi',expired);
  timer.observe({type:'tool.started',data:{id:'call'}});
  await vi.advanceTimersByTimeAsync(700);
  const update={type:'tool.updated' as const,data:{id:'call',result:{content:[{type:'text',text:'one'}]}}};
  timer.observe(update);await vi.advanceTimersByTimeAsync(700);
  timer.observe({...update,data:{...update.data,result:{content:[{type:'text',text:'two'}]}}});
  await vi.advanceTimersByTimeAsync(700);timer.observe({type:'tool.finished',data:{id:'call'}});
  await vi.advanceTimersByTimeAsync(700);
  timer.observe({type:'tool.finished',data:{id:'call'}});
  timer.observe({type:'tool.updated',data:{id:'other',result:{content:[]}}});
  timer.observe({type:'engine.status',data:{label:'正在思考…'}});
  timer.observe({type:'message.delta',data:{text:''}});
  expect(expired).not.toHaveBeenCalled();await vi.advanceTimersByTimeAsync(300);expect(expired).toHaveBeenCalledTimes(1);
});

it('重复的在途工具输出不续期，另一个运行的进展不影响本轮',async()=>{
  const expired=vi.fn(),otherExpired=vi.fn(),timer=new RunInactivityTimer(1000,'Pi',expired),other=new RunInactivityTimer(1000,'Codex',otherExpired);
  const update={type:'tool.updated' as const,data:{id:'call',result:{content:[{type:'text',text:'unchanged'}]}}};
  timer.observe(update);await vi.advanceTimersByTimeAsync(600);timer.observe(update);other.progress();
  await vi.advanceTimersByTimeAsync(400);expect(expired).toHaveBeenCalledTimes(1);expect(otherExpired).not.toHaveBeenCalled();other.dispose();
});

// 直接驱动真实适配器的 run/事件转换，以确定性协议端点替代进程和供应商；不声称原生验收。
function adapter(kind:'pi'|'codex'|'claude'){
  const options={agentHome:'unused',prompt:'test',turnTimeoutMs:1000,knowledge:{list:async()=>[],call:async()=>({content:[]})}};
  const context={source:undefined,emit:async()=>{}};
  if(kind==='pi'){
    const engine=new PiEngine({...options,provider:'test',model:'test',process:{command:'unused',args:[]}}) as any;
    engine.context=context;engine.rpc={request:async(type:string)=>type==='prompt'?{disposition:'started'}:{},close:async()=>{}};
    return {engine,progress:()=>engine.consume({type:'message_update',assistantMessageEvent:{type:'thinking_delta',delta:'private thought'}}),tool:()=>engine.consume({type:'tool_execution_end',toolCallId:'one',toolName:'read',result:{content:[]}}),noise:()=>engine.consume({type:'auto_retry_start',attempt:1}),finish:()=>engine.consume({type:'agent_settled'})};
  }
  if(kind==='codex'){
    const engine=new CodexEngine({...options,llm:{apiKey:'secret',profile:{model:'test',reasoning:false} as any}}) as any;
    engine.context=context;engine.threadId='thread';engine.rpc={request:async()=>({turn:{id:'turn'}}),close:async()=>{}};
    engine.proxy={usage:()=>undefined,error:()=>undefined,assertSettled:async()=>{},close:async()=>{}};engine.bind=async()=>{};
    return {engine,progress:()=>engine.notification('item/reasoning/textDelta',{threadId:'thread',turnId:'turn',delta:'private thought'}),tool:()=>engine.emit({type:'tool.finished',data:{id:'one'}}),noise:()=>engine.notification('item/agentMessage/delta',{threadId:'thread',turnId:'old-turn',delta:'late output'}),finish:()=>engine.notification('turn/completed',{threadId:'thread',turn:{id:'turn',status:'completed'}})};
  }
  const engine=new ClaudeCodeEngine(options) as any;
  const queue:any[]=[];let wake:((event:any)=>void)|undefined;
  const send=(event:any)=>{if(wake){const next=wake;wake=undefined;next(event)}else queue.push(event)};
  engine.context=context;engine.bound=true;engine.push=()=>{};
  engine.query={async *[Symbol.asyncIterator](){while(true){const value=queue.length?queue.shift():await new Promise(resolve=>{wake=resolve});if(value===null)return;yield value}},close:()=>send(null),interrupt:async()=>{}};
  return {engine,progress:async()=>send({type:'stream_event',event:{type:'content_block_delta',delta:{type:'thinking_delta',thinking:'private thought'}}}),tool:()=>engine.emit({type:'tool.finished',data:{id:'one'}}),noise:async()=>send({type:'system',subtype:'status',status:'compacting'}),finish:async()=>send({type:'result',is_error:false,usage:{input_tokens:1,output_tokens:1},total_cost_usd:0})};
}

it.each(['pi','codex','claude'] as const)('%s 的推理增量和工具完成续期，正常结束释放计时器',async kind=>{
  const f=adapter(kind),run=f.engine.run('test');
  for(let i=0;i<4;i++){await vi.advanceTimersByTimeAsync(700);await f.progress()}
  await vi.advanceTimersByTimeAsync(700);await f.tool();await vi.advanceTimersByTimeAsync(700);await f.finish();
  expect(await run).toEqual({status:'completed'});expect(vi.getTimerCount()).toBe(0);await f.engine.close();
});

it.each(['pi','codex','claude'] as const)('%s 连续无进展会中断，噪声或过期轮次不能续期',async kind=>{
  const f=adapter(kind),outcome=f.engine.run('test').catch((error:Error)=>error);
  await vi.advanceTimersByTimeAsync(700);await f.noise();await vi.advanceTimersByTimeAsync(300);
  expect(await outcome).toMatchObject({message:expect.stringContaining('1 秒无执行进展')});expect(vi.getTimerCount()).toBe(0);await f.engine.close();
});

it.each(['pi','codex','claude'] as const)('%s 显式停止不会被残留超时改写为中断',async kind=>{
  const f=adapter(kind),run=f.engine.run('test');await vi.advanceTimersByTimeAsync(500);
  await f.engine.stop();if(kind==='pi')await f.finish();
  expect(await run).toEqual({status:'cancelled'});await vi.advanceTimersByTimeAsync(2000);expect(vi.getTimerCount()).toBe(0);await f.engine.close();
});
