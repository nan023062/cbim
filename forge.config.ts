import type { ForgeConfig } from '@electron-forge/shared-types';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { MakerZIP } from '@electron-forge/maker-zip';
import fs from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {packageOfficialEngineRuntimes} from './scripts/package-pi-runtime.mjs';
import {signingConfig, desktopSigningMode, updaterConfigYaml} from './scripts/desktop-signing/config.cjs';
import {verifyBrandAssets} from './scripts/build-brand-assets.mjs';
import {runtimeSigningKey,stageColdRuntime} from './scripts/runtime-packaging';
import {desktopBuilds} from './desktop-builds';

// Keep one timestamp across Forge's package/make phases and any child processes.
const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date());
const part=(name:string)=>parts.find(p=>p.type===name)!.value;
const buildStamp=process.env.CBIM_BUILD_STAMP||`${part('year')}${part('month')}${part('day')}-${part('hour')}${part('minute')}${part('second')}`;
if(!/^\d{8}-\d{6}$/.test(buildStamp))throw Error('CBIM_BUILD_STAMP 必须为 YYYYMMDD-HHmmss');
process.env.CBIM_BUILD_STAMP=buildStamp;
const buildOut=path.resolve(process.env.CBIM_BUILD_OUT||path.join('build',buildStamp));
const metadataPath=path.join(buildOut,'build-info.json');
const desktopRelease=process.env.CBIM_DESKTOP_RELEASE==='1';
const signingMode=desktopRelease?desktopSigningMode():'signed';
const signing=desktopRelease&&signingMode==='signed'?signingConfig():undefined;
const desktopVersion=process.env.CBIM_DESKTOP_VERSION||JSON.parse(readFileSync('package.json','utf8')).version;
if(desktopRelease&&!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(desktopVersion))throw Error('桌面版本格式无效');
const executableName=desktopRelease?'CBIM Desktop':'CBIM';
async function saveBuildInfo(info:unknown){
  await fs.mkdir(buildOut,{recursive:true});await fs.writeFile(metadataPath,JSON.stringify(info,null,2)+'\n');
  await fs.mkdir('build',{recursive:true});const latest=path.resolve('build/latest-build.json'),tmp=latest+'.'+process.pid+'.tmp';
  await fs.writeFile(tmp,JSON.stringify(info,null,2)+'\n');await fs.rename(tmp,latest);
}
const config: ForgeConfig = {
  outDir: buildOut,
  packagerConfig: { asar: true, executableName, icon:path.resolve('branding/cbim.ico'), ...(desktopRelease?{appVersion:desktopVersion,buildVersion:desktopVersion}:{}),extraResource: ['branding','legal','node_modules/koffi',...(desktopRelease?[path.join(buildOut,'desktop-release.json'),path.join(buildOut,'app-update.yml')]:[])] },
  makers: [new MakerZIP({}, ['win32'])],
  hooks:{
    prePackage:async()=>{await runtimeSigningKey()},
    generateAssets:async()=>{await verifyBrandAssets();await packageOfficialEngineRuntimes(buildOut);if(desktopRelease){const notes=await fs.readFile(process.env.CBIM_DESKTOP_NOTES||`design/releases/desktop-v${desktopVersion}.md`,'utf8');await fs.writeFile(path.join(buildOut,'desktop-release.json'),JSON.stringify({channel:'desktop-stable',version:desktopVersion,notes,signingMode}));await fs.writeFile(path.join(buildOut,'app-update.yml'),updaterConfigYaml(desktopVersion,signing?.publisherName,signingMode))}},
    readPackageJson:async(_config,pkg)=>desktopRelease?{...pkg,version:desktopVersion}:pkg,
    packageAfterPrune:async(_config,appDirectory)=>{
      await runtimeSigningKey();
      const notes=desktopRelease?JSON.parse(await fs.readFile(path.join(buildOut,'desktop-release.json'),'utf8')).notes:'本地验证构建';
      await stageColdRuntime(appDirectory,buildOut,desktopVersion,notes);
    },
    postPackage:async(_config,result)=>{
      for(const directory of result.outputPaths){
        await fs.cp(path.join(buildOut,'bundled-resources'),path.join(directory,'resources/bundled-resources'),{recursive:true,errorOnExist:true,force:false});
        await fs.copyFile(path.join(buildOut,'runtime-initial.json'),path.join(directory,'resources/runtime-initial.json'));
      }
      await saveBuildInfo({buildStamp,timeZone:'Asia/Shanghai',stage:'package',completedAt:new Date().toISOString(),outputDirectory:buildOut,platform:result.platform,arch:result.arch,executable:result.platform==='win32'?path.join(result.outputPaths[0],executableName+'.exe'):null,packageDirectories:result.outputPaths,artifacts:[]});
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
  plugins: [new VitePlugin(desktopBuilds)],
};
export default config;
