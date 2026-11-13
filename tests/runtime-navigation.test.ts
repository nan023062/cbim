import {expect,it,vi} from 'vitest';
import {RuntimeNavigationResolver,bindRuntimeConversation,runtimeTaskSelection} from '../src/view/shell/runtime-navigation';
import type {WorkspaceView} from '../src/bridge/contracts/workspace';
import type {TabLayout} from '../src/view/shell/tabs';

const target={workspaceId:'workspace-a',rootSessionId:'main-a',taskId:'member-a',scopeId:'scope-a'};
const workspace:WorkspaceView={id:target.workspaceId,instanceId:'instance-a',name:'团队 A',path:'C:/project-a',state:'running',tasks:[]};
const records=[{runId:'run-a',task:{workspaceId:workspace.id,taskId:target.rootSessionId,mode:'chat',goal:'原始目标\n上下文附件'}}];
function deferred<T>(){let resolve!:(value:T)=>void,reject!:(error:Error)=>void;const promise=new Promise<T>((ok,fail)=>{resolve=ok;reject=fail});return {promise,resolve,reject}}

it('定位仅查询同一就绪实例和真实主会话，忽略目标附带的非身份信息，不调用执行或 open',async()=>{
  const read=vi.fn(async(action:string)=>action==='list'?{entries:[workspace]}:records);
  const resolver=new RuntimeNavigationResolver(read);
  const verified=await resolver.resolve(target);
  expect(verified).toEqual({target,workspace,conversation:{taskId:'main-a',goal:'原始目标\n上下文附件'}});
  expect(read.mock.calls).toEqual([['list'],['loop.list',{id:workspace.id}],['list']]);
});

it('不同工作区、非聊天、不可读和缺失的原会话均拒绝；后台未就绪不尝试打开',async()=>{
  for(const rows of [[],[{taskId:'main-a',runId:'broken',status:'unreadable'}],[{task:{...records[0].task,workspaceId:'workspace-b'}}],[{task:{...records[0].task,mode:'member'}}]]){
    const resolver=new RuntimeNavigationResolver(async action=>action==='list'?{entries:[workspace]}:rows);
    await expect(resolver.resolve(target)).rejects.toThrow();
  }
  const read=vi.fn(async()=>({entries:[{...workspace,state:'closed'}]}));
  await expect(new RuntimeNavigationResolver(read).resolve(target)).rejects.toThrow('未就绪');
  expect(read).toHaveBeenCalledTimes(1);
});

it('会话读取期间实例重开或退役，原目标不得写入页面',async()=>{
  for(const changed of [{...workspace,instanceId:'new-instance'},{...workspace,state:'closing'}]){
    let lists=0;const read=vi.fn(async(action:string)=>action==='list'?{entries:[++lists===1?workspace:changed]}:records);
    await expect(new RuntimeNavigationResolver(read).resolve(target)).rejects.toThrow();
    expect(read.mock.calls).toHaveLength(3);
  }
});

it('切屏取消、较新导航和迟到错误均不能覆盖后续页面',async()=>{
  const gate=deferred<unknown>();let listReads=0;
  const read=vi.fn(async(action:string)=>action==='list'&&++listReads===1?gate.promise:action==='list'?{entries:[workspace]}:records);
  const resolver=new RuntimeNavigationResolver(read),old=resolver.resolve(target);
  const newer=await resolver.resolve({...target,taskId:undefined,scopeId:undefined});
  expect(newer?.target.taskId).toBeUndefined();gate.resolve({entries:[workspace]});expect(await old).toBeUndefined();
  expect(read.mock.calls.filter(call=>call[0]==='loop.list')).toHaveLength(1);
  const delayed=deferred<unknown>(),cancelled=new RuntimeNavigationResolver(()=>delayed.promise),pending=cancelled.resolve(target);
  cancelled.cancel();delayed.reject(Error('迟到的网络错误'));await expect(pending).resolves.toBeUndefined();
});

it('已有原会话页签只切 active，保留草稿、附件、标题与其他工作区',async()=>{
  const verified=(await new RuntimeNavigationResolver(async action=>action==='list'?{entries:[workspace]}:records).resolve(target))!;
  const attachment={id:'attachment',kind:'file' as const,name:'参考文件',source:'managed/file'};
  const layout:TabLayout={active:'draft',tabs:[{id:'draft',kind:'chat',title:'尚未发送',draft:'独立草稿'},{id:'original',kind:'chat',title:'自定义标题',taskId:'main-a',draft:'原会话草稿',attachments:[attachment]}]};
  const other:TabLayout={active:'b',tabs:[{id:'b',kind:'chat',title:'B',taskId:'main-a',draft:'另一工作区'}]};
  const original=structuredClone({layout,other}),selected=bindRuntimeConversation(layout,verified);
  expect(selected.active).toBe('original');expect(selected.tabs).toBe(layout.tabs);expect({layout,other}).toEqual(original);
  expect(bindRuntimeConversation(selected,verified)).toBe(selected);
});

it('缺少本机页签时只补原历史绑定，双击不重复，也不挪用未发送草稿',async()=>{
  const verified=(await new RuntimeNavigationResolver(async action=>action==='list'?{entries:[workspace]}:records).resolve(target))!;
  const layout:TabLayout={active:'draft',tabs:[{id:'draft',kind:'chat',title:'新对话',draft:'保留我'}]};
  const selected=bindRuntimeConversation(layout,verified),repeated=bindRuntimeConversation(selected,verified);
  expect(repeated).toBe(selected);expect(selected.tabs).toHaveLength(2);expect(selected.tabs[0]).toBe(layout.tabs[0]);
  expect(selected.tabs[1]).toMatchObject({taskId:'main-a',title:'原始目标'});expect(selected.active).toBe(selected.tabs[1].id);
});

const identity={workspaceId:target.workspaceId,rootSessionId:target.rootSessionId};
const graph={identity,root:{nodeId:'session:main-a'},tasks:[{taskId:'member-a',scopeId:'scope-a'},{taskId:'member-other',scopeId:'scope-other'}]};
const scopes=[{scopeId:'scope-a'},{scopeId:'scope-other'}];
it('未启动成员仍按真实图定位节点和历史周期；主会话使用真实根而非把 rootSessionId 当业务 task',()=>{
  expect(runtimeTaskSelection(target,identity,graph,scopes)).toEqual({taskId:'member-a',scopeId:'scope-a'});
  expect(runtimeTaskSelection({...target,scopeId:undefined},identity,graph,scopes)).toEqual({taskId:'member-a',scopeId:'scope-a'});
  expect(runtimeTaskSelection({...target,taskId:'main-a'},identity,graph,scopes)).toEqual({taskId:'session:main-a',scopeId:'scope-a'});
  expect(runtimeTaskSelection({workspaceId:target.workspaceId,rootSessionId:'main-a'},identity,undefined,[])).toEqual({taskId:'session:main-a'});
  expect(graph.tasks).toHaveLength(2);
});

it('图和请求跨会话、缺节点、缺周期或节点错周期时明确拒绝，不回退当前或最新',()=>{
  expect(()=>runtimeTaskSelection(target,{...identity,rootSessionId:'other'},graph,scopes)).toThrow('当前会话');
  expect(()=>runtimeTaskSelection(target,identity,{...graph,identity:{...identity,workspaceId:'other'}},scopes)).toThrow('身份不一致');
  expect(()=>runtimeTaskSelection({...target,taskId:'missing'},identity,graph,scopes)).toThrow('原任务节点');
  expect(()=>runtimeTaskSelection({...target,scopeId:'missing'},identity,graph,scopes)).toThrow('原目标周期');
  expect(()=>runtimeTaskSelection({...target,scopeId:'scope-other'},identity,graph,scopes)).toThrow('不一致');
});
