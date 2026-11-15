/** 只核对设计原型的语法、页面目录、静态图标与自包含资源；不作为产品行为测试。 */
import fs from 'node:fs';
import vm from 'node:vm';
const path=new URL('./cbim-complete-ux-prototype.html',import.meta.url);
let html=fs.readFileSync(path,'utf8');
if(process.argv.includes('--embed')){
  const sprite=fs.readFileSync(new URL('./cbim-icon-sprite.svg',import.meta.url),'utf8');
  const chart='<svg xmlns="http://www.w3.org/2000/svg"><symbol id="cbim-chart" viewBox="0 0 24 24"><path d="M3 3v18h18M7 17v-4M12 17V9M17 17V5" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/></symbol></svg>';
  if(!html.includes('<!-- ICON_SPRITE -->'))throw new Error('Sprite already embedded; do not overwrite edited artwork');
  html=html.replace('<!-- ICON_SPRITE -->',sprite+chart);
  fs.writeFileSync(path,html,'utf8');
}
const script=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
if(!script)throw new Error('Missing script');
new vm.Script(script);
const pageLiteral=script.match(/const pages=(\[[\s\S]*?\n\])\.map/)[1];
const pages=vm.runInNewContext(pageLiteral,Object.create(null),{timeout:1000});
if(pages.length!==42||new Set(pages.map(p=>p[0])).size!==42)throw new Error('Page inventory mismatch');
const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
// 动态模板可包含重复的同页标识；这里只检查正文静态部分。
const staticHtml=html.split('<script>')[0];
const staticIds=[...staticHtml.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
if(new Set(staticIds).size!==staticIds.length)throw new Error('Duplicate static id');
const symbols=new Set([...html.matchAll(/<symbol id="cbim-([^"]+)"/g)].map(m=>m[1]));
const used=new Set(pages.map(p=>p[4]==='users'?'team':p[4]));
for(const m of script.matchAll(/\bicon\('([^']+)'/g))used.add(m[1]);
for(const m of script.matchAll(/\bbutton\('[^']*','[^']*','([^']+)'/g))used.add(m[1]);
const alias={clock:'queued',warning:'decision',image:'inspect'};
const missing=[...used].filter(name=>!symbols.has(alias[name]||name));
if(missing.length)throw new Error('Missing icons: '+missing.join(','));
if(/<(script|link|img)[^>]+(?:src|href)="https?:/i.test(html))throw new Error('External asset dependency');
console.log(JSON.stringify({pages:pages.length,existingInterfaces:pages.filter(p=>p[8]!=='proposal'&&p[0]!=='style').length,designSystemPages:1,proposalPages:pages.filter(p=>p[8]==='proposal').length,symbols:symbols.size,staticIds:staticIds.length,scriptSyntax:'passed',selfContained:true},null,2));
