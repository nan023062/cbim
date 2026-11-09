import {_electron} from 'playwright-core';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {latestExecutable} from './build-artifact.mjs';

const executable=await latestExecutable(),output=path.resolve('test-results/branding-website');await fs.mkdir(output,{recursive:true});
const profile=await fs.mkdtemp(path.join(output,'isolated-user-'));
const app=await _electron.launch({executablePath:executable,env:{...process.env,CBIM_USER_DATA_ROOT:profile},timeout:60000});
const errors=[];
try{
  const page=await app.firstWindow();page.on('pageerror',error=>errors.push(error.message));
  await page.locator('.workspace-welcome').waitFor({timeout:30000});
  assert.equal(await page.title(),'CBIM Assistant');assert.equal(await page.locator('.wordmark').textContent(),'CBIM');
  const marks=await page.locator('.wordmark img,.intro-emblem img').evaluateAll(images=>images.map(image=>({src:image.src,loaded:image.complete&&image.naturalWidth===128,width:image.width,height:image.height})));
  assert.equal(marks.length,2);assert.ok(marks.every(mark=>mark.loaded));
  const identity=await app.evaluate(({app})=>({name:app.getName(),version:app.getVersion(),packaged:app.isPackaged,userData:app.getPath('userData')}));
  assert.equal(identity.name,'CBIM Assistant');assert.equal(identity.packaged,true);assert.ok(path.resolve(identity.userData).startsWith(profile+path.sep));
  // Electron 的 shell 文件关联查询可能返回通用 EXE 图标；用 Windows 原生资源提取核对这个具体程序。
  const iconPath=path.join(output,'exe-icon.png');
  const script="Add-Type -AssemblyName System.Drawing; $brandIcon = [System.Drawing.Icon]::ExtractAssociatedIcon($env:CBIM_BRAND_TEST_EXE); try { $brandIcon.ToBitmap().Save($env:CBIM_BRAND_TEST_ICON, [System.Drawing.Imaging.ImageFormat]::Png) } finally { $brandIcon.Dispose() }";
  const extraction=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,encoding:'utf8',env:{...process.env,CBIM_BRAND_TEST_EXE:executable,CBIM_BRAND_TEST_ICON:iconPath}});
  assert.equal(extraction.status,0,extraction.stderr);const actualIcon=await fs.readFile(iconPath);
  const ico=await fs.readFile('branding/cbim.ico');const count=ico.readUInt16LE(4);assert.equal(count,7);
  const match=await app.evaluate(({nativeImage},{ico,actual})=>{
    const bytes=Buffer.from(ico,'base64'),actualImage=nativeImage.createFromBuffer(Buffer.from(actual,'base64')),size=actualImage.getSize();
    const count=bytes.readUInt16LE(4);let target;
    for(let i=0;i<count;i++){const row=6+16*i,width=bytes[row]||256;if(width===size.width){target=bytes.subarray(bytes.readUInt32LE(row+12),bytes.readUInt32LE(row+12)+bytes.readUInt32LE(row+8));break}}
    if(!target)throw Error('EXE icon size missing from ICO');
    const expected=nativeImage.createFromBuffer(target).toBitmap(),bitmap=actualImage.toBitmap();let equal=0;
    for(let i=0;i<bitmap.length;i+=4){if(bitmap.subarray(i,i+4).every((value,index)=>Math.abs(value-expected[i+index])<=2))equal++}
    return {size,pixelMatch:equal/(bitmap.length/4)};
  },{ico:ico.toString('base64'),actual:actualIcon.toString('base64')});
  assert.ok(match.pixelMatch>.98,`EXE 图标与同源 ICO 不一致：${match.pixelMatch}`);
  for(const theme of ['light','dark']){
    await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await page.screenshot({path:path.join(output,`desktop-${theme}.png`)});
  }
  assert.deepEqual(errors,[]);
  const packaged=path.join(path.dirname(executable),'resources/branding');
  for(const name of ['cbim-mark.svg','cbim.png','cbim.ico'])assert.equal(createHash('sha256').update(await fs.readFile(path.join(packaged,name))).digest('hex'),createHash('sha256').update(await fs.readFile(path.join('branding',name))).digest('hex'));
  await fs.writeFile(path.join(output,'desktop-report.json'),JSON.stringify({passed:true,executable,identity,marks,match,errors},null,2));
  console.log(JSON.stringify({passed:true,executable,match,errors}));
}finally{await app.close()}
