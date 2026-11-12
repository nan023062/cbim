/**
 * 目录归属：backend/engines/claude；Claude 引擎适配。
 * 作用定位：从 CBIM 自带资源或开发依赖加载固定版本的 Claude Agent SDK。
 * 设计原因：SDK 自带 CLI 与平台二进制保留独立目录，打包后不借用 Cindy 或用户外部 Claude 安装。
 */
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import type {query} from '@anthropic-ai/claude-agent-sdk';

/** 仅加载固定第三方包，入口不来自 IPC、模型或工作区文件。 */
export async function loadClaudeSdk():Promise<{query:typeof query}>{
  const requireRuntime=createRequire(typeof __filename==='string'?__filename:import.meta.url);
  const resources=(process as NodeJS.Process & {resourcesPath?:string}).resourcesPath;
  const entry=requireRuntime.resolve('@anthropic-ai/claude-agent-sdk',{paths:[...(resources?[path.join(resources,'claude-runtime')]:[]),...requireRuntime.resolve.paths('@anthropic-ai/claude-agent-sdk')??[]]});
  return import(pathToFileURL(entry).href);
}
