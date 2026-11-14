import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it} from 'vitest';
import {RepositoryScopeDetails} from '../src/view/components/RepositoryScopeDetails';
import {ToolTimeline as ToolActivity} from '../src/view/execution-view/ToolTimeline';
import {brainStatus} from '../src/view/conversation/brain-status';
import type {RunSummary,StoredEvent} from '../src/bridge/contracts/execution';

const scope={kind:'repository',workspaceId:'workspace-a',connectorId:'.cbim/connectors/repository',repositoryId:'10000000-0000-4000-8000-000000000001',connectionId:'20000000-0000-4000-8000-000000000001',operation:'get'};
const event=(type:StoredEvent['type'],data:StoredEvent['data'],seq=1)=>({type,data,seq,workspaceId:'workspace-a',taskId:'task',runId:'run',time:'2026-11-07T00:00:00.000Z'} as StoredEvent);
const run=(events:StoredEvent[]):RunSummary=>({task:{taskId:'task',workspaceId:'workspace-a',root:'C:/fixture',goal:'读取仓库资料',moduleIds:[],acceptance:[]},runId:'run',status:'running',acceptance:'not_evaluated',unresolvedTools:[],events});

it('仓库范围明确显示安全身份及资料边界，旧或损坏范围不补造',()=>{
  const render=(value:unknown)=>renderToStaticMarkup(createElement(RepositoryScopeDetails,{scope:value}));
  const text=render(scope);expect(text).toContain('资源仓库 · 读取资料');expect(text).toContain(scope.connectorId);expect(text).toContain(scope.repositoryId);expect(text).toContain(scope.connectionId);expect(text).toContain('资料不等于业务文件实现或验收证据');
  for(const value of [undefined,{kind:'workspace',workspaceId:'workspace-a'},{...scope,connectionId:undefined},{...scope,token:'not-public'}])expect(render(value)).toBe('');
});

it('工具轨道只用授权或真实回执范围，不从模型传入的scope伪造仓库证明',()=>{
  const proposed=event('tool.proposed',{id:'call',name:'read',input:{path:'note.md',scope}});
  const untrusted=renderToStaticMarkup(createElement(ToolActivity,{run:run([proposed])}));expect(untrusted).not.toContain('data-testid="repository-tool-scope"');
  const allowed=event('tool.allowed',{id:'call',name:'cbim_repository_get',input:{connectorId:scope.connectorId},allow:true,scope},2);
  const receipt={version:1,toolCallId:'call',toolName:'cbim_repository_get',workspaceId:'workspace-a',taskId:'task',runId:'run',outcome:'succeeded',inputHash:'a'.repeat(64),resultHash:'b'.repeat(64),effects:['read'],scope,recordedAt:'2026-11-07T00:00:00.000Z'};
  const finished=event('tool.finished',{id:'call',name:'cbim_repository_get',isError:false,receipt,result:{content:[{type:'text',text:'资料片段'}]}},3);
  const trusted=renderToStaticMarkup(createElement(ToolActivity,{run:run([allowed,finished])}));expect(trusted).toContain('data-testid="repository-tool-scope"');expect(trusted).toContain('读取仓库资料');expect(trusted).toContain('运行回执');expect(trusted).toContain('资料片段');
});

it('输入区状态区分仓库资料与项目文件，并仍由真实终态覆盖',()=>{
  const listing=run([event('tool.started',{id:'list',name:'cbim_repository_list'})]),reading=run([event('tool.started',{id:'get',name:'cbim_repository_get'})]);
  expect(brainStatus(listing)).toBe('正在查询仓库资源…');expect(brainStatus(reading)).toBe('正在读取仓库资料…');expect(brainStatus({...reading,status:'cancelled'})).toBe('已停止');expect(brainStatus(run([event('tool.started',{id:'read',name:'read'})]))).toBe('正在读取文件…');
});
