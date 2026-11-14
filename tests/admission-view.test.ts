import {expect,it,vi,afterEach} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {AdmissionFeed,sessionAdmission} from '../src/view/tasks/admission-state';
import {AdmissionNotice} from '../src/view/tasks/AdmissionNotice';
import {continuationRejected} from '../src/view/tasks/continuation-state';
import {recoveryRejected} from '../src/view/tasks/recovery-state';
import {replanRejected} from '../src/view/tasks/replan-state';
import {UsageStatus} from '../src/view/conversation/UsageStatus';
import type {AdmissionSnapshot,AdmissionTicket} from '../src/bridge/contracts/admission';

const time='2026-11-07T00:00:00.000Z';
const ticket:AdmissionTicket={workspaceId:'ws',ownerEpoch:1,rootSessionId:'root',taskId:'task',requestId:'request',source:'member',workspacePermission:'read',ticketId:'ticket',order:1,requestedAt:time,reason:'global_capacity'};
const snapshot=(revision=1):AdmissionSnapshot=>({cursor:{streamId:'stream',revision},policy:{revision:1,maxConcurrentRuns:1},occupied:[],waiting:[{...ticket}]});
afterEach(()=>vi.useRealTimers());

it('多订阅共用单次在途读取，noop不换引用、不重绘；取消最后订阅停止轮询',async()=>{
  vi.useFakeTimers();let finish!:(value:unknown)=>void;
  const read=vi.fn(()=>new Promise(resolve=>{finish=resolve})),feed=new AdmissionFeed(read),changed=vi.fn(),off=feed.subscribe(changed),off2=feed.subscribe(()=>{});
  const pending=feed.refresh();expect(read).toHaveBeenCalledTimes(1);await vi.advanceTimersByTimeAsync(3000);expect(read).toHaveBeenCalledTimes(1);
  finish({kind:'snapshot',snapshot:snapshot()});await pending;const prior=feed.snapshot;expect(changed).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1000);expect(read).toHaveBeenCalledTimes(2);expect(read.mock.calls[1]).toEqual([snapshot().cursor]);
  const next=feed.refresh();finish({kind:'noop',cursor:snapshot().cursor});await next;expect(feed.snapshot).toBe(prior);expect(changed).toHaveBeenCalledTimes(1);
  off();off2();await vi.advanceTimersByTimeAsync(5000);expect(read).toHaveBeenCalledTimes(2);
});

it('旧订阅迟到响应不覆盖新代际，读取失败保留旧数据并明确标记过期',async()=>{
  vi.useFakeTimers();let finish!:(value:unknown)=>void;
  const read=vi.fn().mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve})).mockResolvedValue({kind:'snapshot',snapshot:snapshot(2)}),feed=new AdmissionFeed(read);
  const off=feed.subscribe(()=>{}),pending=feed.refresh();off();const changed=vi.fn(),off2=feed.subscribe(changed);
  finish({kind:'snapshot',snapshot:snapshot(1)});await pending;expect(changed).not.toHaveBeenCalled();expect(feed.snapshot.data).toBeUndefined();
  await vi.advanceTimersByTimeAsync(0);expect(feed.snapshot.data?.cursor.revision).toBe(2);const data=feed.snapshot.data;
  read.mockRejectedValueOnce(Error('连接中断'));await feed.refresh();expect(feed.snapshot.data).toBe(data);expect(feed.snapshot.error).toContain('连接中断');
  const html=renderToStaticMarkup(createElement(AdmissionNotice,{tickets:data!.waiting,error:feed.snapshot.error}));expect(html).toContain('上次数据可能已过期');expect(html).not.toContain('名额释放后继续');
  read.mockResolvedValueOnce({kind:'noop',cursor:data!.cursor});await feed.refresh();expect(feed.snapshot.error).toBe('');expect(feed.snapshot.data).toBe(data);off2();
});

it('会话等待严格隔离，只有没有真实占用才显示无运行等待，票据不作为持久恢复入口',()=>{
  const data=snapshot();data.waiting.push({...ticket,ticketId:'other',rootSessionId:'another',order:2});
  expect(sessionAdmission(data,'ws','root')).toMatchObject({waitingOnly:true,waiting:[ticket],waitingSince:time});
  expect(sessionAdmission(data,'ws','another').waiting).toHaveLength(1);expect(sessionAdmission(data,'other','root').waiting).toHaveLength(0);
  const {ticketId,order,requestedAt,reason,...request}=ticket;data.occupied.push({...request,requestId:'active',acquiredAt:time});
  expect(sessionAdmission(data,'ws','root').waitingOnly).toBe(false);
  const html=renderToStaticMarkup(createElement(AdmissionNotice,{tickets:[ticket]}));expect(html).toContain('等待运行名额');expect(html).toContain('尚未启动');expect(html).not.toContain('<button');
});

it('首次容量拒绝为未受理；未知错误不当作可编辑，准入等待不显示生成动画',()=>{
  for(const check of [continuationRejected,recoveryRejected,replanRejected]){expect(check(Error('CAPACITY_BUSY: 尚未受理'))).toBe(true);expect(check(Error('IPC_TIMEOUT'))).toBe(false)}
  const html=renderToStaticMarkup(createElement(UsageStatus,{runs:[],currentRun:null,now:Date.parse(time)+30000,placement:'above',activity:{active:false,label:'正在等待执行资格',tone:'neutral',waitingSince:time}}));
  expect(html).toContain('正在等待执行资格');expect(html).not.toContain('usage-sparkle');expect(html).toContain('0s');
});
