/**
 * 目录归属：backend/engines/codex；Codex 引擎适配。
 * 作用定位：解析 CBIM 随包的固定 Codex 原生 App Server，不启动用户 PATH 中的客户端。
 * 设计原因：直接持有实际子进程才能等待退出；平台二进制与 CLI 版本一起冻结，不借用外部账号或安装。
 * 独立下载包可直接提供预编译 EXE，依然限制为当前适配器验证的版本；不在用户机器编译。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import type {EngineRuntimePackage} from '../../../logic/execution/rules/engine-runtime';

/** 只解析固定生产依赖；返回值不受模型、IPC 或工作区配置控制。 */
export async function codexBinary(runtime?:EngineRuntimePackage){
  if(runtime){if(runtime.version!=='0.167.0')throw Error('当前资源版本尚未验证此 Codex 引擎版本');await fs.access(runtime.entry);return runtime.entry;}
  const local=createRequire(typeof __filename==='string'?__filename:import.meta.url);
  const resources=(process as NodeJS.Process & {resourcesPath?:string}).resourcesPath;
  const manifest=local.resolve('@openai/codex/package.json',{paths:[...(resources?[path.join(resources,'codex-runtime')]:[]),...local.resolve.paths('@openai/codex')??[]]});
  const pkg=JSON.parse(await fs.readFile(manifest,'utf8'));if(pkg.version!=='0.167.0')throw Error('Codex 运行资源版本不匹配');
  const triples:Record<string,string>={'win32-x64':'x86_64-pc-windows-msvc','win32-arm64':'aarch64-pc-windows-msvc','linux-x64':'x86_64-unknown-linux-musl','linux-arm64':'aarch64-unknown-linux-musl','darwin-x64':'x86_64-apple-darwin','darwin-arm64':'aarch64-apple-darwin'};
  const target=process.platform+'-'+process.arch,triple=triples[target];if(!triple)throw Error('当前平台没有受支持的 Codex 运行资源');
  const platform=createRequire(manifest).resolve('@openai/codex-'+target+'/package.json');
  const file=path.join(path.dirname(platform),'vendor',triple,'bin',process.platform==='win32'?'codex.exe':'codex');await fs.access(file);return file;
}
