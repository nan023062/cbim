import {expect,it} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ToolTimeline} from '../src/frontend/execution-view/ToolTimeline';
import {knowledgeToolView} from '../src/frontend/execution-view/knowledge-tool-view';
import type {RunSummary} from '../src/bridge/contracts/execution';

const identity={workspaceId:'workspace',instanceId:'instance',revision:'a'.repeat(64)};
const result=(data:unknown)=>({content:[{type:'text',text:JSON.stringify(data)}]});
const preview={request:{...identity,requestId:'request',changes:[]},changes:[],validation:{structural:false,architecture:'review-required',business:'not-run',indexes:{},tree:{nodes:{},roots:[]},issues:[{severity:'error',code:'summary',path:'module.json',message:'摘要须为 100–250 个非空白字符'},{severity:'error',code:'sections',path:'module.md',message:'五个标题需要逐字匹配'}]},affected:[],diff:'',fingerprint:'b'.repeat(64),planId:'plan',objects:[],notice:'预览不写入'};
const receipt={...identity,state:'committed',requestId:'request',changed:['module.json'],cleanupWarnings:[]};
function run(name:string,data:unknown,isError=false):RunSummary{return {task:{taskId:'task',workspaceId:'workspace',root:'.',goal:'治理知识',moduleIds:[],acceptance:[]},runId:'run',status:'completed',acceptance:'not_evaluated',unresolvedTools:[],events:[{version:1,seq:1,taskId:'task',runId:'run',workspaceId:'workspace',time:'2026-11-11T00:00:00Z',type:'tool.finished',data:{id:'call',name,result:data,isError}}]}}

it('所有预览诊断显示为校验警告，执行异常仍保留失败',()=>{
 const view=renderToStaticMarkup(createElement(ToolTimeline,{run:run('cbim_object_preview',result(preview))}));
 expect(view).toContain('validation-warning');expect(view).toContain('校验未通过');expect(view).toContain('摘要须为');expect(view).toContain('五个标题需要逐字匹配');expect(view).not.toContain('执行失败');
 const failed=renderToStaticMarkup(createElement(ToolTimeline,{run:run('cbim_object_preview',result(preview),true)}));expect(failed).toContain('执行失败');expect(failed).not.toContain('validation-warning');
});
it('只有完整同工作区的原提交回执显示知识写入完成，不签发业务验收',()=>{
 const html=renderToStaticMarkup(createElement(ToolTimeline,{run:run('cbim_object_commit',result(receipt))}));expect(html).toContain('知识写入已完成');expect(html).toContain('事务');expect(html).toContain('request');expect(html).not.toContain('目标已完成');
 for(const [name,data] of [['cbim_object_preview',receipt],['cbim_object_commit',{...receipt,workspaceId:'foreign'}],['cbim_object_commit',{state:'committed'}]] as const)expect(knowledgeToolView(name,result(data),'workspace')).toBeUndefined();
 expect(knowledgeToolView('cbim_object_commit',{...result(receipt),isError:true},'workspace')).toBeUndefined();
 expect(knowledgeToolView('cbim_object_commit',{content:[...result(receipt).content,{type:'text',text:'extra'}]},'workspace')).toBeUndefined();
});
it('只有失败、中断或返回丢失的控制入口突出显示，成功回执默认收起',()=>{
 const render=(value:RunSummary)=>renderToStaticMarkup(createElement(ToolTimeline,{run:value,renderControls:({attention})=>createElement('span',null,attention?'需核实':'可选核实')}));
 expect(render(run('cbim_object_commit',result(receipt)))).toContain('可选核实');
 expect(render(run('write',undefined))).toContain('需核实');
 const stopped=run('write',undefined);stopped.events[0].type='tool.started';stopped.status='interrupted';expect(render(stopped)).toContain('结果未核实');expect(render(stopped)).toContain('open=""');
});
