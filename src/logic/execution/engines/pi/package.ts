/**
 * 作用定位：Pi 官方包的统一工厂入口，拥有 SDK 版本和进程准备策略。
 * 设计原因：宿主不再知道 Pi 的启动脚本或 SDK 版本；开发模式仍可注入受控 RPC 进程。
 */
import path from 'node:path';
import {createRequire} from 'node:module';
import fs from 'node:fs';
import {PiEngine} from './engine';
import type {EngineAdapter,EngineAdapterOptions} from '../../rules/engine-adapter';

function command(options:EngineAdapterOptions){
  if(options.runtime&&options.runtime.version!=='1.5.0')throw Error('此 Pi 适配器尚未验证该 SDK 版本');
  if(options.process)return options.process;
  if(options.runtime){return {command:process.execPath,args:[options.runtime.entry],env:{ELECTRON_RUN_AS_NODE:'1'}}}
  const locate=createRequire(typeof __filename==='string'?__filename:import.meta.url);
  const resources=(process as NodeJS.Process & {resourcesPath?:string}).resourcesPath;
  const roots=[...(resources?[path.join(resources,'pi-runtime','node_modules')]:[]),...(locate.resolve.paths('@earendil-works/pi-coding-agent')??[])];
  for(const root of roots){
    const directory=path.join(root,'@earendil-works/pi-coding-agent');let source:string;
    try{source=fs.readFileSync(path.join(directory,'package.json'),'utf8')}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')continue;throw error}
    if(JSON.parse(source).version!=='1.5.0')throw Error('当前 Loop Engine 仅验证过 Pi 1.5.0');
    const entry=path.join(directory,'dist/bundle/rpc-entry.js');fs.accessSync(entry);return {command:process.execPath,args:[entry],env:{ELECTRON_RUN_AS_NODE:'1'}};
  }
  throw Error('缺少 Pi 运行时，请先安装项目依赖');
}
export const engineAdapter:EngineAdapter=Object.freeze({protocol:1,id:'pi',version:'1.0.0',create:(options:EngineAdapterOptions)=>new PiEngine({...options,process:command(options)})});
