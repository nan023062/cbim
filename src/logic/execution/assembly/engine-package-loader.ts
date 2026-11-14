/**
 * 作用定位：从冷宿主已验证的不可变包路径加载统一引擎工厂。
 * 设计原因：生产装配不导入具体适配器；包身份、协议和路径二次核对后才创建实例，错误不触发回退或重新下载。
 * 职责边界：本函数不验证签名或发现目录；runtime 只能由受管制品端口提供，不能来自 IPC、模型或工作区文件。
 */
import path from 'node:path';
import {createRequire} from 'node:module';
import {checkedEngineAdapter} from '../rules/engine-adapter';
import type {EngineRuntimePackage} from '../rules/engine-runtime';

const loadAdapter=createRequire(typeof __filename==='string'?__filename:import.meta.url);
/** 仅从经过完整文件校验的目录读取声明入口，Node 按不可变绝对路径缓存模块。 */
export function packagedEngineAdapter(id:string,runtime:EngineRuntimePackage){
  const descriptor=runtime.adapter;if(!descriptor)throw Error('引擎包缺少统一适配器入口，请准备兼容版本');
  const relative=path.relative(path.resolve(runtime.root),path.resolve(descriptor.entry));
  if(!relative||relative.startsWith('..')||path.isAbsolute(relative)||!descriptor.entry.endsWith('.cjs')||descriptor.protocol!==1)throw Error('引擎包入口路径或协议无效');
  const loaded=loadAdapter(descriptor.entry) as {engineAdapter?:unknown};
  return checkedEngineAdapter(loaded.engineAdapter,{id,version:descriptor.version});
}
