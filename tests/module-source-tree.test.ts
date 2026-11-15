import {expect,it} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ModuleSourceTree} from '../src/view/workspace/ModuleSourceTree';
import type {Snapshot} from '../src/bridge/contracts/workspace';
const id='.cbim/workspace/app';
const snapshot:Snapshot={workspaceId:'w',instanceId:'i',revision:'r',files:[{path:id+'/module.json',text:'{}',hash:'x'}],validation:{issues:[],indexes:{},structural:true,architecture:'review-required',business:'not-run',tree:{roots:[id],nodes:{[id]:{id,name:'app',summary:'应用',children:[],sources:[{location:'src/app',scope:'业务源码'}]}}}}};
it('树只包含模块和真实来源入口，首次渲染不枚举文件或触发治理',()=>{
 let actions=0;
 const html=renderToStaticMarkup(createElement(ModuleSourceTree,{snapshot,query:'',selected:id,onModule:()=>{actions++},onFile:()=>{actions++},actions:()=>[]}));
 expect(html).toContain('data-module-id="'+id+'"');expect(html).toContain('src/app');expect(html).not.toContain('module.json');expect(html).not.toContain('正在读取目录');expect(actions).toBe(0);
});
it('损坏模块循环有界展示，搜索无匹配仍保留根菜单',()=>{
 const cyclic=structuredClone(snapshot);cyclic.validation!.tree.nodes[id].children=[id];
 const html=renderToStaticMarkup(createElement(ModuleSourceTree,{snapshot:cyclic,query:'',selected:id,onModule:()=>{},onFile:()=>{},actions:()=>[]}));
 expect(html).toContain('模块包含关系存在循环');
 const search=renderToStaticMarkup(createElement(ModuleSourceTree,{snapshot,query:'missing',selected:id,onModule:()=>{},onFile:()=>{},actions:()=>[]}));
 expect(search).toContain('业务模块');expect(search).toContain('没有匹配的模块');expect(search).not.toContain('src/app');
});
