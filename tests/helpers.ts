import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {Application} from '../src/backend/main/application';
import {Paths} from '../src/backend/main/platform/paths';
import {json,hash} from '../src/backend/core/foundation/serialization';
import {randomUUID} from 'node:crypto';
import type {Snapshot,Change,KnowledgeFile} from '../src/bridge/contracts/workspace';
import {knowledgeTools} from '../src/backend/scheduler-engine/tools/knowledge-tools';
import type {Workspace} from '../src/backend/main/workspace/workspace';
/** 测试直接经过内部知识工具与逐调用权限，不启动外部传输或修改工作区全局授权。 */
export function internalKnowledge(workspace:Workspace){
  const service=knowledgeTools(workspace),identity={workspaceId:workspace.entry.id,instanceId:workspace.instanceId};
  const call=async(name:string,args:Record<string,unknown>={},write=false)=>JSON.parse((await service.callFromRun(name,{...identity,...args},write)).content[0].text);
  return {service,identity,call};
}
export async function fixture(){const temp=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-test-'));const user=path.join(temp,'user');const a=path.join(temp,'a','same'),b=path.join(temp,'b','same');await fs.mkdir(a,{recursive:true});await fs.mkdir(b,{recursive:true});const app=new Application(new Paths(user,path.resolve('.')),path.resolve('design'));await app.init();return {temp,user,a,b,app,cleanup:async()=>{await app.shutdown();const target=path.resolve(temp);if(path.dirname(target)!==path.resolve(os.tmpdir())||!path.basename(target).startsWith('cbim-test-'))throw Error('Refusing to remove paths outside this test directory');await fs.rm(target,{recursive:true,force:true})}}}
export const request=(snapshot:Snapshot,changes:Change[])=>({workspaceId:snapshot.workspaceId,instanceId:snapshot.instanceId,revision:snapshot.revision,requestId:randomUUID(),changes});
export const summary='管理团队客户端资源加载、卸载与缓存，提供加载器和实例生命周期接口。包含异步请求取消、对象池复用、回调有效性检查与过期资源清理，支持定位加载失败、实例释放和重复请求问题。底层资源传输由相关系统提供，本模块负责运行期调用与生命周期管理。';
export function moduleFiles(name='game',children:string[]=[],sources:any[]=[]):KnowledgeFile[]{const id='.cbim/workspace/'+name;const data={id,name:name.split('/').at(-1),summary,authors:[],sources,connectors:[],children,overview:'module.md',workflows:[]};const body=`# ${data.name}\n\n## 定位\n管理资源。\n\n## 子模块和 source 节点\n无\n\n## 结构关系图与抽象设计决策\n\n\`\`\`mermaid\nclassDiagram\nclass Game\n${sources.length?'class CbimDirectContent["直属内容（虚拟子模块）"]\n<<virtual>> CbimDirectContent\n':''}\`\`\`\n无\n\n## 雷区与排障\n无\n\n## 观察模式-待抽象\n无\n`;return [{path:id+'/module.json',text:json(data),hash:''},{path:id+'/module.md',text:body,hash:''}].map(f=>({...f,hash:hash(f.text)}))}
