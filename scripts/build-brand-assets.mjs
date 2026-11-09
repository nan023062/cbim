import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const root=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const sizes=[16,24,32,48,64,128,256];

/** 打包前只校验已提交资源；图标源变更后必须显式生成，避免静默使用旧 ICO。 */
export async function verifyBrandAssets(){
  const manifest=JSON.parse(await fs.readFile(path.join(root,'branding/generated.json'),'utf8'));
  for(const name of ['cbim-mark.svg','cbim.png','cbim.ico']){
    if(hash(await fs.readFile(path.join(root,'branding',name)))!==manifest.sha256[name])throw Error(`品牌资源已变化：${name}；请运行 pnpm build:brand 后一起提交生成资源。`);
  }
  return manifest;
}

/** 同一 SVG 在实际 Chromium 中逐尺寸渲染；ICO 内保留各自栅格，不用单张图片放大小图标。 */
async function generate(){
  const {_electron}=await import('playwright-core');
  const {default:electron}=await import('electron');
  const svg=await fs.readFile(path.join(root,'branding/cbim-mark.svg'));
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  const app=await _electron.launch({executablePath:electron,args:[path.join(root,'scripts/brand-renderer.cjs')],cwd:root,env});
  try{
    const page=await app.firstWindow();
    const images=await page.evaluate(async({source,sizes})=>{
      const image=new Image();image.src='data:image/svg+xml;base64,'+source;await image.decode();
      return sizes.map(size=>{const canvas=document.createElement('canvas');canvas.width=canvas.height=size;canvas.getContext('2d').drawImage(image,0,0,size,size);return canvas.toDataURL('image/png').split(',')[1]});
    },{source:svg.toString('base64'),sizes:[...sizes,512]});
    const buffers=images.map(value=>Buffer.from(value,'base64'));
    const header=Buffer.alloc(6+16*sizes.length);header.writeUInt16LE(1,2);header.writeUInt16LE(sizes.length,4);
    let offset=header.length;
    sizes.forEach((size,index)=>{const at=6+index*16;header[at]=header[at+1]=size===256?0:size;header.writeUInt16LE(1,at+4);header.writeUInt16LE(32,at+6);header.writeUInt32LE(buffers[index].length,at+8);header.writeUInt32LE(offset,at+12);offset+=buffers[index].length});
    const ico=Buffer.concat([header,...buffers.slice(0,sizes.length)]),png=buffers.at(-1);
    await fs.writeFile(path.join(root,'branding/cbim.ico'),ico);await fs.writeFile(path.join(root,'branding/cbim.png'),png);
    await fs.writeFile(path.join(root,'branding/generated.json'),JSON.stringify({source:'cbim-mark.svg',sizes,sha256:{'cbim-mark.svg':hash(svg),'cbim.png':hash(png),'cbim.ico':hash(ico)}},null,2)+'\n');
    console.log('品牌图标已生成：512 px PNG，16–256 px 多尺寸 ICO。');
  }finally{await app.close()}
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.argv.includes('--check')){await verifyBrandAssets();console.log('品牌图标摘要一致。')}
  else await generate();
}
