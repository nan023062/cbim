import {test,expect} from 'vitest';
import {fixture} from './helpers';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';

test('real Pi discovers task tools and persists a delivery candidate backed by an actual file read',async()=>{
  const f=await fixture();let turn=0;const bodies:any[]=[];
  const calls=[
    {name:'cbim_task_plan',args:{expectedVersion:0,goal:'核实文件',reason:'用户请求',acceptance:['读取实际文件内容'],steps:[{id:'check',title:'读取文件',owner:'主 Agent'}]}},
    {name:'read',args:{path:'proof.txt'}},
    {name:'cbim_task_step',args:{expectedVersion:1,id:'check',state:'reported_done',evidenceIds:['call-1']}},
    {name:'cbim_delivery_prepare',args:{expectedVersion:2,summary:'文件已读取，等待审阅',limitations:['只核实文字内容']}},
  ];
  const server=http.createServer(async(req,res)=>{
    let body='';for await(const chunk of req)body+=chunk;bodies.push(JSON.parse(body));
    res.writeHead(200,{'Content-Type':'text/event-stream'});
    const emit=(delta:unknown,finish_reason:string|null)=>res.write('data: '+JSON.stringify({id:'task-'+turn,object:'chat.completion.chunk',created:1,model:'task-model',choices:[{index:0,delta,finish_reason}]})+'\n\n');
    const call=calls[turn];if(call){emit({role:'assistant',tool_calls:[{index:0,id:'call-'+turn,type:'function',function:{name:call.name,arguments:JSON.stringify(call.args)}}]},null);emit({},'tool_calls')}else{emit({role:'assistant',content:'已准备交付候选，尚未验收。'},null);emit({},'stop')}
    turn++;res.end('data: [DONE]\n\n');
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const entry=await f.app.dispatch('add',{path:f.a}),manager=f.app.execution(entry.id);
    await fs.writeFile(path.join(f.a,'proof.txt'),'ACTUAL_FILE_PROOF');
    const home=path.join(f.app.paths.project(entry.id),'loop-engine','pi');await fs.mkdir(home,{recursive:true});
    await fs.writeFile(path.join(home,'models.json'),JSON.stringify({providers:{'task-provider':{baseUrl:`http://127.0.0.1:${(server.address() as any).port}/v1`,api:'openai-completions',apiKey:'test-only',models:[{id:'task-model',reasoning:false,input:['text'],contextWindow:32768,maxTokens:1024,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}}]}}}));
    const run=await manager.chat('核实文件并记录交付候选',{provider:'task-provider',model:'task-model',permission:'read',allowNativeExecution:false,turnTimeoutMs:20000});
    await expect.poll(async()=>(await manager.inspect(run.taskId,run.runId)).status,{timeout:25000}).not.toBe('running');
    const result=await manager.inspect(run.taskId,run.runId);
    expect(result.status).toBe('completed');
    expect(result.taskProgress,JSON.stringify(result.events.filter(e=>e.type==='tool.finished'))).toMatchObject({version:3,state:'awaiting_review',steps:[{state:'reported_done',evidence:['call-1']}]});
    expect(result.acceptance).toBe('not_evaluated');expect(result.events.filter(e=>e.type==='task.updated')).toHaveLength(3);
    expect(JSON.stringify(bodies.at(-1).messages)).toContain('ACTUAL_FILE_PROOF');
    expect(bodies[0].tools.some((t:any)=>t.function.name==='cbim_task_plan')).toBe(true);
    expect(bodies[0].tools.some((t:any)=>t.function.name==='write')).toBe(false);
    expect(result.toolReceipts?.every(r=>r.outcome==='succeeded'&&r.runId===run.runId)).toBe(true);
  }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await f.cleanup()}
},35000);
