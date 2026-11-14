import {expect,test} from 'vitest';
import type {EngineEvent,StoredEvent} from '../src/logic/execution/rules/types';
import {runUsage} from '../src/logic/execution/rules/usage';

const events=(...items:EngineEvent[]):StoredEvent[]=>items.map((item,index)=>({
  version:1,workspaceId:'workspace',taskId:'task',runId:'run',seq:index+1,time:new Date(index*1000).toISOString(),...item
}));
const message=(patch:Record<string,unknown>={}):EngineEvent=>({type:'message',data:{
  role:'assistant',usage:{input:100,output:50,cacheRead:30,cacheWrite:10,reasoning:20,cost:{total:0.01}},...patch
}});
const summary=(patch:Record<string,unknown>={}):EngineEvent=>({type:'engine.status',data:{
  metric:'run-usage',tokens:{input:200,output:70,cacheRead:30,cacheWrite:10},cost:0.02,pricingKnown:true,...patch
}});

test('per-run native summary replaces message totals and never adds reasoning twice',()=>{
  expect(runUsage(events(message(),message(),summary()))).toEqual({
    input:200,output:70,cacheRead:30,cacheWrite:10,reasoning:40,total:310,
    cost:0.02,costPartial:false,usageReported:true
  });
  expect(runUsage(events(message(),summary({tokens:{input:200,output:70,cacheRead:30,cacheWrite:10,reasoning:60}})))).toMatchObject({reasoning:60,total:310});
});

test.each(['cancelled','failed','interrupted'])('reported spend survives %s settlement',status=>{
  const result=runUsage(events(message({stopReason:'error'}),{type:'run.settled',data:{status}}));
  expect(result).toMatchObject({total:190,cost:0.01,costPartial:false,usageReported:true});
});

test('unknown pricing is distinct from explicit zero price and preserves partial known cost',()=>{
  const unpriced=message({usage:{input:100,output:50,cost:{total:0}},pricingKnown:false});
  expect(runUsage(events(unpriced))).toMatchObject({cost:undefined,costPartial:true,usageReported:true});
  expect(runUsage(events(message(),unpriced))).toMatchObject({cost:0.01,costPartial:true,total:340});
  expect(runUsage(events(message({usage:{output:0,cost:{total:0}},pricingKnown:true})))).toMatchObject({total:0,cost:0,costPartial:false,usageReported:true});
  expect(runUsage(events(message({usage:{output:0,cost:{total:0,totalFromProvider:true}}})))).toMatchObject({cost:0,costPartial:false});
});

test('complete native summary repairs missing message usage and unknown summary prices stay unknown',()=>{
  expect(runUsage(events(message({usage:undefined}),summary()))).toMatchObject({total:310,cost:0.02,costPartial:false,usageReported:true});
  expect(runUsage(events(message(),summary({cost:0,pricingKnown:false})))).toMatchObject({total:310,cost:undefined,costPartial:true});
});

test('last valid native summary wins and malformed values do not poison confirmed totals',()=>{
  const invalid=summary({tokens:{input:-1,output:NaN,cacheRead:Infinity,cacheWrite:0}});
  expect(runUsage(events(message(),summary(),invalid))).toMatchObject({total:310,cost:0.02});
  expect(runUsage(events(summary(),summary({tokens:{input:300,output:90,cacheRead:0,cacheWrite:0},cost:0.04})))).toMatchObject({total:390,cost:0.04});
  expect(runUsage(events(message({usage:{output:NaN}})))).toMatchObject({total:0,cost:undefined,costPartial:true,usageReported:false});
});

test('context occupancy is not cumulative spend and readonly input remains unchanged',()=>{
  const input=events({type:'engine.status',data:{metric:'context',tokens:180000,contextWindow:200000}});
  const before=structuredClone(input);Object.freeze(input);input.forEach(Object.freeze);
  expect(runUsage(input)).toEqual({input:0,output:0,cacheRead:0,cacheWrite:0,reasoning:0,total:0,cost:undefined,costPartial:false,usageReported:false});
  expect(input).toEqual(before);
});
