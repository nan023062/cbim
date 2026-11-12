import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {build,type InlineConfig} from 'vite';
import {desktopBuilds} from '../desktop-builds';
const require=createRequire(import.meta.url);
/** 使用锁定的 Forge Vite 适配器；只编译脚本，不下载 Electron、不打 NSIS，也不运行引擎。 */
export async function buildRuntimeCode(destination:string){
  const plugin=path.dirname(require.resolve('@electron-forge/plugin-vite'));
  const Generator=require(path.join(plugin,'ViteConfig.js')).default;
  const generator=new Generator(desktopBuilds,process.cwd(),true);
  await fs.mkdir(destination,{recursive:true});
  for(const config of await generator.getBuildConfigs() as InlineConfig[])await build({...config,configFile:false,build:{...config.build,outDir:path.join(destination,'build'),emptyOutDir:false}});
  for(const config of await generator.getRendererConfig() as InlineConfig[])await build({...config,configFile:false,build:{...config.build,outDir:path.join(destination,'renderer/main_window')}});
}
