import fs from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {createHash} from 'node:crypto';

if(process.platform!=='win32'||process.arch!=='x64')throw Error('正式安装包当前只支持 Windows x64 构建');
const pkg=JSON.parse(await fs.readFile('package.json','utf8'));
const version=process.env.CBIM_DESKTOP_VERSION||pkg.version;
if(!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version))throw Error('桌面版本格式无效');
const env={...process.env,CBIM_DESKTOP_RELEASE:'1',CBIM_DESKTOP_VERSION:version};
function run(entry,args){const r=spawnSync(process.execPath,[entry,...args],{env,stdio:'inherit'});if(r.status!==0)throw Error(`构建失败：${path.basename(entry)} (${r.status})`)}
run('node_modules/@electron-forge/cli/dist/electron-forge.js',['package']);
const info=JSON.parse(await fs.readFile('build/latest-build.json','utf8'));
const destination=path.resolve('build/desktop-release',version);
try{await fs.access(path.join(destination,`CBIM-Setup-${version}-x64.exe`));throw Error('同版本安装包已存在，请保留验收产物并使用新的版本或明确清理构建目录')}catch(e){if(e.code!=='ENOENT')throw e}
run('node_modules/electron-builder/out/cli/cli.js',['--win','nsis','--x64','--prepackaged',info.packageDirectories[0],'--config','electron-builder.config.cjs','--publish','never']);
const names=[`CBIM-Setup-${version}-x64.exe`,`CBIM-Setup-${version}-x64.exe.blockmap`,'latest.yml'];
const artifacts=[];
for(const name of names){const file=path.join(destination,name),bytes=await fs.readFile(file);artifacts.push({name,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')})}
await fs.writeFile(path.join(destination,'SHA256SUMS.txt'),artifacts.map(a=>`${a.sha256}  ${a.name}`).join('\n')+'\n');
await fs.writeFile(path.join(destination,'build-receipt.json'),JSON.stringify({version,buildStamp:info.buildStamp,packagedExecutable:info.executable,artifacts,completedAt:new Date().toISOString()},null,2)+'\n');
console.log(JSON.stringify({version,destination,artifacts}));
