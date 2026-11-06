import {expect,test} from 'vitest';
import type {RunSummary} from '../src/backend/core/brain/types';
import {taskUsage,tokenCount} from '../src/frontend/conversation/usage';
const run=(events:any[],status='completed')=>({status,events:events.map((e,i)=>({seq:i+1,time:new Date(i*1000).toISOString(),...e}))}) as RunSummary;
const message=(data:any={})=>({type:'message',data:{usage:{input:100,output:50,reasoning:20,cacheRead:30,cacheWrite:10,cost:{total:0}},generationDurationMs:1000,...data}});
test('task time excludes idle gaps, TPS excludes tool time and reasoning is not counted twice',()=>{
 const r=run([{type:'run.started'},message(),{type:'tool.finished'},{type:'run.settled',time:new Date(10000).toISOString()}]);
 const next=run([{type:'run.started',time:new Date(100000).toISOString()},message(),{type:'run.settled',time:new Date(105000).toISOString()}]);
 expect(taskUsage([r,next],110000)).toMatchObject({durationMs:15000,total:380,output:100,reasoning:40,rate:50,cost:undefined});
});
test('unknown zero cost differs from explicit free pricing; incomplete history uses only timed samples',()=>{
 expect(taskUsage([run([message({pricingKnown:true})])],0).cost).toBe(0);
 const data=taskUsage([run([message({generationDurationMs:undefined}),message({pricingKnown:true})])],0);
 expect(data.rate).toBe(50);expect(data.ratePartial).toBe(true);expect(data.costPartial).toBe(true);
});
test('native context can decrease after compaction and null clears obsolete counts',()=>{
 const events=[{type:'engine.status',data:{label:'Pi 运行配置已应用',contextWindow:100000}},{type:'engine.status',data:{metric:'context',contextWindow:100000,tokens:80000}},{type:'engine.status',data:{metric:'context',contextWindow:100000,tokens:20000}}];
 expect(taskUsage([run(events)],0)).toMatchObject({used:20000,capacity:100000,percent:20});
 expect(taskUsage([run([...events,{type:'engine.status',data:{metric:'context',contextWindow:100000,tokens:null}}])],0).used).toBeUndefined();
 expect(taskUsage([run(events),run([{type:'engine.status',data:{label:'Pi 运行配置已应用',contextWindow:65536}}])],0)).toMatchObject({capacity:65536,used:undefined});
});
test('invalid timestamps and compact number boundaries remain readable',()=>{
 expect(taskUsage([run([{type:'run.started',time:'bad'}],'running')],1000).durationMs).toBe(0);
 expect(tokenCount(999999)).toBe('1.0M');expect(tokenCount(32768)).toBe('32.8k');
});
test('native run deltas include summaries without double-counting messages or diluting generation speed',()=>{
 const r=run([message(),{type:'engine.status',data:{metric:'run-usage',tokens:{input:200,output:70,cacheRead:30,cacheWrite:10},cost:0.02,pricingKnown:true}}]);
 expect(taskUsage([r,r],0)).toMatchObject({input:400,output:140,total:620,cost:0.04,rate:50,costPartial:false});
});
