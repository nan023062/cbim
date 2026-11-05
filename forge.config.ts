import type { ForgeConfig } from '@electron-forge/shared-types';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { MakerZIP } from '@electron-forge/maker-zip';
import fs from 'node:fs/promises';
import path from 'node:path';

// Keep one timestamp across Forge's package/make phases and any child processes.
const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date());
const part=(name:string)=>parts.find(p=>p.type===name)!.value;
const buildStamp=process.env.CBIM_BUILD_STAMP||`${part('year')}${part('month')}${part('day')}-${part('hour')}${part('minute')}${part('second')}`;
if(!/^\d{8}-\d{6}$/.test(buildStamp))throw Error('CBIM_BUILD_STAMP 必须为 YYYYMMDD-HHmmss');
process.env.CBIM_BUILD_STAMP=buildStamp;
const buildOut=path.resolve(process.env.CBIM_BUILD_OUT||path.join('build',buildStamp));
const metadataPath=path.join(buildOut,'build-info.json');
async function saveBuildInfo(info:unknown){
  await fs.mkdir(buildOut,{recursive:true});await fs.writeFile(metadataPath,JSON.stringify(info,null,2)+'\n');
  await fs.mkdir('build',{recursive:true});const latest=path.resolve('build/latest-build.json'),tmp=latest+'.'+process.pid+'.tmp';
  await fs.writeFile(tmp,JSON.stringify(info,null,2)+'\n');await fs.rename(tmp,latest);
}
const config: ForgeConfig = {
  outDir: buildOut,
  packagerConfig: { asar: true, executableName: 'CBIM Assistant', extraResource: ['design','node_modules/koffi'] },
  makers: [new MakerZIP({}, ['win32'])],
  hooks:{
    postPackage:async(_config,result)=>{
      await saveBuildInfo({buildStamp,timeZone:'Asia/Shanghai',stage:'package',completedAt:new Date().toISOString(),outputDirectory:buildOut,platform:result.platform,arch:result.arch,executable:result.platform==='win32'?path.join(result.outputPaths[0],'CBIM Assistant.exe'):null,packageDirectories:result.outputPaths,artifacts:[]});
    },
    postMake:async(_config,results)=>{
      for(const result of results)for(let i=0;i<result.artifacts.length;i++){
        const artifact=path.resolve(result.artifacts[i]);if(path.extname(artifact)!=='.zip')continue;
        const filename=`CBIM-Assistant-${buildStamp}-${result.platform}-${result.arch}-${result.packageJSON.version}.zip`;
        const target=path.join(path.dirname(artifact),filename);
        if(target!==artifact){await fs.rename(artifact,target);result.artifacts[i]=target}
      }
      const previous=JSON.parse(await fs.readFile(metadataPath,'utf8'));
      await saveBuildInfo({...previous,stage:'make',completedAt:new Date().toISOString(),artifacts:results.flatMap(r=>r.artifacts)});
      return results;
    },
  },
  plugins: [new VitePlugin({build: [
    {entry:'src/main/main.ts', config:'vite.main.config.ts', target:'main'},
    {entry:'src/preload/preload.ts', config:'vite.preload.config.ts', target:'preload'},
  ], renderer:[{name:'main_window',config:'vite.renderer.config.ts'}]})],
};
export default config;
