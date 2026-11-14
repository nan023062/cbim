import fs from 'node:fs/promises';
import path from 'node:path';
import {builtinModules,createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {build} from 'vite';

// 开发者源码入口，不读取工作区配置或远端脚本。安装后的加载只使用已验证包清单。
export const adapterSources=Object.freeze({pi:'pi','claude-code':'claude',codex:'codex',memory:'memory'});
/** 构建可单独加载的 CJS 工厂；SDK 生产依赖由引擎包原有构建流程提供。 */
export async function buildEngineAdapter(kind,destination){
  const source=adapterSources[kind];if(!source)throw Error('没有已登记的官方引擎构建入口：'+kind);
  const root=path.resolve(fileURLToPath(new URL('..',import.meta.url))),entry=path.join(root,'src/logic/execution/engines',source,'package.ts');
  await fs.mkdir(destination,{recursive:true});
  await build({configFile:false,root,logLevel:'error',build:{target:'node22',emptyOutDir:false,outDir:destination,minify:false,lib:{entry,formats:['cjs'],fileName:()=> 'adapter.cjs'},rollupOptions:{external:[...builtinModules,...builtinModules.map(name=>'node:'+name),'electron','koffi']}}});
  const load=createRequire(import.meta.url),file=path.resolve(destination,'adapter.cjs');delete load.cache[file];
  const {engineAdapter}=load(file);
  if(engineAdapter?.id!==kind||engineAdapter.descriptor?.id!==kind||engineAdapter.protocol!==1||typeof engineAdapter.create!=='function'||!/^\d+\.\d+\.\d+$/.test(engineAdapter.version))throw Error('独立引擎产物协议或声明不符');
  const descriptor={id:engineAdapter.id,version:engineAdapter.version,protocol:engineAdapter.protocol,entry:'adapter.cjs',descriptor:engineAdapter.descriptor};
  await fs.writeFile(path.join(destination,'adapter.json'),JSON.stringify(descriptor,null,2)+'\n');return descriptor;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const kind=process.argv[2];if(!kind)throw Error('用法：node scripts/build-engine-adapters.mjs <引擎 ID> [输出目录]');
  // 此模块也由 CommonJS tsx/Forge 配置同步加载；顶层 await 会令整个 ESM 图无法被 require。
  void buildEngineAdapter(kind,path.resolve(process.argv[3]??path.join('build','engine-adapters',kind))).then(result=>console.log(JSON.stringify(result))).catch(error=>{console.error(error.message);process.exitCode=1});
}
