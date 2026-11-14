import {expect,it} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {officeScene,OfficeEventTracker} from '../src/view/tasks/office-state';
import {OfficeScene} from '../src/view/tasks/OfficeScene';
import {officeGraph,officeTask,officeSession,officeTime} from './team-conversation-fixture';
import type {ScopeSummary} from '../src/bridge/contracts/dispatch';

const scope:ScopeSummary={scopeId:'topic',status:'active',createdAt:officeTime,hasGoal:true,hasPlan:false,inputPreview:'当前目标',stamp:{scopeId:'topic',streamId:'scopes:graph',seq:1}};
it('同一逻辑成员的不同执行实例只显示一人，当前模块与串行待办分别展示',()=>{
 const current={...officeTask('one'),status:'running' as const,activeRunId:'run',modules:[{moduleId:'module-a',name:'模块 A',knowledgeRevision:'k',maintenanceBindingId:'m',maintainerPersonIds:['p'],workflow:{kind:'general' as const,id:'general',version:'1',reason:'test'}}]},other={...officeTask('two'),modules:current.modules};
 const graph=officeGraph([current,other]),sessions=[officeSession(),{...officeSession('foreign'),rootSessionId:'other'}];
 const scene=officeScene(graph,sessions,[scope],true);expect(scene.actors).toHaveLength(2);expect(scene.actors[1]).toMatchObject({id:'worker-session',taskId:'one',deskId:'module:module-a',queued:1,working:true});expect(scene.desks.map(value=>value.name)).toEqual(['主 Agent 工位','模块 A']);
 const html=renderToStaticMarkup(createElement(OfficeScene,{graph,sessions,scopes:[scope],mainRunning:true,queued:2,onChat:()=>{},onTask:()=>{}}));
 expect(html.match(/data-office-actor="worker-session"/g)).toHaveLength(1);expect(html).toContain('打开 建模员 的对话');expect(html).toContain('同一 Agent 串行');expect(html).not.toContain('foreign');expect(html).not.toContain('type="checkbox"');expect(html).not.toContain('人物动态');expect(html).toContain('office-person-drawing working');
});
it('完成/撤销任务默认折叠，空闲 Agent 的独立会话仍保留',()=>{
 const graph=officeGraph([{...officeTask('old'),status:'cancelled'}]),scene=officeScene(graph,[officeSession()],[scope],false);
 expect(scene.current).toEqual([]);expect(scene.history).toHaveLength(1);expect(scene.actors[1]).toMatchObject({state:'空闲',deskId:'lounge'});
 const html=renderToStaticMarkup(createElement(OfficeScene,{graph,sessions:[officeSession()],scopes:[scope],mainRunning:false,queued:0,onChat:()=>{},onTask:()=>{}}));expect(html).toContain('<details class="office-history">');expect(html).toContain('当前没有待处理任务');
});
it('可靠等待和正在退出区分，不借迟到 running 显示仍在作业',()=>{
 const graph=officeGraph([{...officeTask('one'),status:'running',activeRunId:'run'}]);
 const pausing={...scope,interruption:{commandId:'id',phase:'requested' as const}};
 expect(officeScene(graph,[officeSession()],[pausing],true).actors.every(actor=>actor.state==='正在暂停')).toBe(true);
 const paused={...scope,status:'waiting' as const};expect(officeScene(graph,[officeSession()],[paused],true).actors.every(actor=>!actor.working)).toBe(true);
});
it('只播放可见期间新增的真实派发和回传，重复快照/旧版本/换办公室均不重放',()=>{
 const tracker=new OfficeEventTracker(),graph=officeGraph([officeTask('old')]);expect(tracker.observe(graph)).toEqual([]);
 graph.cursor.seq++;graph.tasks.push(officeTask('new'));expect(tracker.observe(graph)).toMatchObject([{kind:'assignment',taskId:'new'}]);expect(tracker.observe(graph)).toEqual([]);
 graph.cursor.seq++;graph.tasks[1].result={resultId:'candidate',runId:'run',planRevision:1,summary:'候选',evidenceRefs:[],limitations:[],acceptance:'not_evaluated'};
 expect(tracker.observe(graph)).toMatchObject([{kind:'feedback',id:'result:candidate',scopeId:'topic'}]);
 expect(tracker.observe({...graph,cursor:{...graph.cursor,seq:1}})).toEqual([]);
 graph.cursor.seq++;graph.tasks.push(officeTask('hidden'));expect(tracker.observe(graph,false)).toEqual([]);expect(tracker.observe(graph,true)).toEqual([]);
 expect(tracker.observe({...graph,identity:{...graph.identity,rootSessionId:'another'},cursor:{...graph.cursor,rootSessionId:'another',seq:100}})).toEqual([]);
});
it('模块原 ID 与主工位/休息区同名时仍有独立工位',()=>{
 const task=officeTask('same-name');task.modules=[{moduleId:'main',name:'业务主模块',knowledgeRevision:'k',maintenanceBindingId:'m',maintainerPersonIds:['p'],workflow:{kind:'general',id:'general',version:'1',reason:'test'}}];
 const scene=officeScene(officeGraph([task]),[officeSession()],[scope],false);
 expect(scene.desks.map(desk=>desk.id)).toEqual(['main','module:main']);expect(scene.actors.map(actor=>actor.deskId)).toEqual(['main','module:main']);
});

it('侧栏选择只突出本办公室逻辑成员，不改变任务选择或执行状态',()=>{
 const props={graph:officeGraph([officeTask('one')]),sessions:[officeSession()],scopes:[scope],mainRunning:false,queued:0,onChat:()=>{},onTask:()=>{}};
 const html=renderToStaticMarkup(createElement(OfficeScene,{...props,selectedAgentSessionId:'worker-session'}));
 expect(html).toContain('data-selected="true" data-office-actor="worker-session"');
 expect(html).toContain('data-selected="false" data-office-actor="main:root"');
 const foreign=renderToStaticMarkup(createElement(OfficeScene,{...props,selectedAgentSessionId:'foreign-session'}));expect(foreign).not.toContain('data-selected="true"');
});
