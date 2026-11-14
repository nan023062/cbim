/**
 * 目录归属：logic/execution/engines/claude；Claude 引擎适配。
 * 作用定位：从 CBIM 自带资源或开发依赖加载固定版本的 Claude Agent SDK。
 * 设计原因：SDK 自带 CLI 与平台二进制保留独立目录，打包后不借用 Cindy 或用户外部 Claude 安装。
 * 受管安装通过已验证 E 包入口加载 SDK，仍核对当前适配器支持的版本；开发/旧测试保留原解析路径。
 */
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import type {query} from '@anthropic-ai/claude-agent-sdk';
import type {EngineRuntimePackage} from '../../rules/engine-runtime';

/** 仅加载固定第三方包，入口不来自 IPC、模型或工作区文件。 */
export async function loadClaudeSdk(runtime?:EngineRuntimePackage):Promise<{query:typeof query}>{
  if(runtime&&runtime.version!=='0.3.322')throw Error('当前资源版本尚未验证此 Claude 引擎版本');
  const requireRuntime=createRequire(typeof __filename==='string'?__filename:import.meta.url);
  const resources=(process as NodeJS.Process & {resourcesPath?:string}).resourcesPath;
  const entry=runtime?.entry??requireRuntime.resolve('@anthropic-ai/claude-agent-sdk',{paths:[...(resources?[path.join(resources,'claude-runtime')]:[]),...requireRuntime.resolve.paths('@anthropic-ai/claude-agent-sdk')??[]]});
  return import(pathToFileURL(entry).href);
}
