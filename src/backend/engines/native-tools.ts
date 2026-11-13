/**
 * 目录归属：backend/engines；宿主管理的原生工具。
 * 作用定位：向宿主托管引擎提供已有文件/命令工具操作，复用 Pi SDK 的独立工具实现而不创建 Pi Loop。
 * 设计原因：Codex 内置执行不能覆盖每次 CBIM 授权；复用已有读取、编辑、输出截断及取消行为，避免维护第二套文件语义。
 * 受管安装只搜索被签名清单固定的 Pi 包；Codex 仍显式准备该依赖，不因未选择 Pi 模型而省略工具库。
 * Windows 根相对路径使用工作区盘符，与授权的路径解析保持一致，不受宿主进程所在盘符影响。
 */
import path from 'node:path';
import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import type * as NativeSdk from '@earendil-works/pi-coding-agent';
import type {EngineToolsPort} from '../../logic/execution/rules/engine-tools';
import type {EngineRuntimePackage} from '../../logic/execution/rules/engine-runtime';

/** 只补齐 Windows 单根分隔符路径的盘符；UNC、完整绝对路径、普通相对路径及 POSIX 输入保持原语义。 */
export function nativeToolInput(name:string,input:Record<string,unknown>,cwd:string,platform:NodeJS.Platform=process.platform):Record<string,unknown>{
  if(platform==='win32'&&['read','write','edit','find','grep','ls'].includes(name)&&typeof input.path==='string'&&/^[/\\](?![/\\])/.test(input.path)){
    return {...input,path:path.win32.resolve(cwd,input.path)};
  }
  return input;
}

/** 固定第三方操作库，优先使用受管 E 根，旧包兼容 pi-runtime；只创建工具，不创建会话或读取模型账号。 */
export async function managedNativeTools(cwd:string,runtime?:EngineRuntimePackage):Promise<EngineToolsPort>{
  if(runtime&&runtime.version!=='1.5.0')throw Error('原生工具运行包版本不匹配');
  const resolve=createRequire(typeof __filename==='string'?__filename:import.meta.url),resources=(process as NodeJS.Process & {resourcesPath?:string}).resourcesPath;
  let entry='';for(const root of runtime?[path.join(runtime.root,'node_modules')]:[...(resources?[path.join(resources,'pi-runtime','node_modules')]:[]),...resolve.resolve.paths('@earendil-works/pi-coding-agent')??[]]){
    const folder=path.join(root,'@earendil-works/pi-coding-agent');
    const raw=await fs.readFile(path.join(folder,'package.json'),'utf8').catch(error=>{if(error.code==='ENOENT')return undefined;throw error});if(raw===undefined)continue;
    if(JSON.parse(raw).version!=='1.5.0')throw Error('原生工具版本不匹配');const candidate=path.join(folder,'dist','index.js');await fs.access(candidate);entry=candidate;break;
  }if(!entry)throw Error('缺少 CBIM 原生工具运行资源');
  const sdk:typeof NativeSdk=await import(pathToFileURL(entry).href);
  const tools=[sdk.createReadTool(cwd),sdk.createWriteTool(cwd),sdk.createEditTool(cwd),sdk.createBashTool(cwd),sdk.createFindTool(cwd),sdk.createGrepTool(cwd),sdk.createLsTool(cwd)];
  return {list:async()=>tools.map(tool=>({name:tool.name,description:tool.description,inputSchema:JSON.parse(JSON.stringify(tool.parameters))})),call:async(name,args,signal,id)=>{
    const tool=tools.find(tool=>tool.name===name);if(!tool||!id)throw Error('本轮未提供该原生工具');signal.throwIfAborted();return tool.execute(id,nativeToolInput(name,args,cwd) as never,signal);
  }};
}
