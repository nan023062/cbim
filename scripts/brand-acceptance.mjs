import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';

/** 核对真实窗口和 Windows 原生资源；复用已启动的隔离程序，不安装或启动用户客户端。 */
export async function verifyDesktopBrand({app,page,executable,installer,output}){
  await fs.mkdir(output,{recursive:true});
  await page.locator('.workspace-welcome .intro-emblem img').waitFor();
  const marks=await page.locator('.intro-emblem img').evaluateAll(images=>images.map(image=>({src:image.src,loaded:image.complete&&image.naturalWidth===256,width:image.width,height:image.height})));
  assert.equal(marks.length,1);assert.ok(marks.every(mark=>mark.loaded));
  const ico=await fs.readFile('assets/branding/cbim.ico');assert.equal(ico.readUInt16LE(4),7);
  const icons=[];
  for(const [kind,file] of [['exe',executable],...(installer?[['installer',installer]]:[])]){
    const iconPath=path.join(output,kind+'-icon.png');
    const script="Add-Type -AssemblyName System.Drawing; $icon = [System.Drawing.Icon]::ExtractAssociatedIcon($env:CBIM_BRAND_TEST_EXE); try { $bitmap=$icon.ToBitmap(); try { $bitmap.Save($env:CBIM_BRAND_TEST_ICON, [System.Drawing.Imaging.ImageFormat]::Png) } finally { $bitmap.Dispose() } } finally { $icon.Dispose() }";
    const result=spawnSync(process.env.GITHUB_ACTIONS==='true'?'pwsh.exe':'powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,encoding:'utf8',env:{...process.env,CBIM_BRAND_TEST_EXE:file,CBIM_BRAND_TEST_ICON:iconPath}});
    assert.equal(result.status,0,result.stderr);
    const actual=await fs.readFile(iconPath);
    const variants={};
    for(let i=0;i<ico.readUInt16LE(4);i++){const at=6+16*i;variants[ico[at]||256]=ico.subarray(ico.readUInt32LE(at+12),ico.readUInt32LE(at+12)+ico.readUInt32LE(at+8)).toString('base64')}
    const match=await page.evaluate(async({variants,actual})=>{
      const decode=async base64=>{const image=new Image();image.src='data:image/png;base64,'+base64;await image.decode();return image};
      const image=await decode(actual),size={width:image.naturalWidth,height:image.naturalHeight};
      if(!variants[size.width])throw Error('Native icon size missing from ICO');
      const expected=await decode(variants[size.width]);
      if(expected.naturalWidth!==size.width||expected.naturalHeight!==size.height)throw Error('Icon dimensions mismatch');
      const pixels=image=>{const canvas=document.createElement('canvas');canvas.width=size.width;canvas.height=size.height;const context=canvas.getContext('2d');context.drawImage(image,0,0);return context.getImageData(0,0,size.width,size.height).data};
      const a=pixels(image),b=pixels(expected);let equal=0;
      for(let i=0;i<a.length;i+=4)if(a.subarray(i,i+4).every((value,index)=>Math.abs(value-b[i+index])<=2))equal++;
      return {size,pixelMatch:equal/(a.length/4)};
    },{variants,actual:actual.toString('base64')});
    assert.ok(match.pixelMatch>.98,kind+' icon mismatch: '+match.pixelMatch);icons.push({kind,file,...match});
  }
  const digest=bytes=>createHash('sha256').update(bytes).digest('hex'),resources={};
  for(const name of ['cbim-mark.svg','cbim.png','cbim.ico']){
    const packaged=await fs.readFile(path.join(path.dirname(executable),'resources/branding',name));
    resources[name]=digest(packaged);assert.equal(resources[name],digest(await fs.readFile(path.join('assets/branding',name))));
  }
  const theme=await page.evaluate(()=>document.documentElement.dataset.theme);
  for(const value of ['light','dark']){await page.evaluate(value=>document.documentElement.dataset.theme=value,value);await page.screenshot({path:path.join(output,'brand-'+value+'.png')})}
  await page.evaluate(theme=>{if(theme===undefined)delete document.documentElement.dataset.theme;else document.documentElement.dataset.theme=theme},theme);
  const report={passed:true,marks,icons,resources};
  await fs.writeFile(path.join(output,'brand-report.json'),JSON.stringify(report,null,2)+'\n');return report;
}
