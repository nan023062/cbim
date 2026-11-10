import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {Application} from '../src/backend/main/application';
import {Paths} from '../src/backend/main/platform/paths';
import {knowledgeTools} from '../src/backend/scheduler-engine/tools/knowledge-tools';
import type {Workspace} from '../src/backend/main/workspace/workspace';
/** 测试直接经过内部知识工具与逐调用权限，不启动外部传输或修改工作区全局授权。 */
export function internalKnowledge(workspace:Workspace){
  const service=knowledgeTools(workspace),identity={workspaceId:workspace.entry.id,instanceId:workspace.instanceId};
  const call=async(name:string,args:Record<string,unknown>={},write=false)=>JSON.parse((await service.callFromRun(name,{...identity,...args},write)).content[0].text);
  return {service,identity,call};
}
export async function fixture(){const temp=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-test-'));const user=path.join(temp,'user');const a=path.join(temp,'a','same'),b=path.join(temp,'b','same');await fs.mkdir(a,{recursive:true});await fs.mkdir(b,{recursive:true});const app=new Application(new Paths(user,path.resolve('.')),path.resolve('design'));await app.init();return {temp,user,a,b,app,cleanup:async()=>{await app.shutdown();const target=path.resolve(temp);if(path.dirname(target)!==path.resolve(os.tmpdir())||!path.basename(target).startsWith('cbim-test-'))throw Error('Refusing to remove paths outside this test directory');await fs.rm(target,{recursive:true,force:true})}}}
// 兼容完整应用测试；领域测试应直接引用纯数据入口，避免加载本文件的 Application。
export {request,summary,moduleFiles} from './knowledge-data';
