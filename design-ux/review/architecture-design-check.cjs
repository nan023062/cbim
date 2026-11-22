const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert/strict');
const root='design-ux',index=fs.readFileSync(root+'/README.md','utf8');let count=0;
for(const folder of fs.readdirSync(root+'/src/view')){
 const dir=root+'/src/view/'+folder;
 assert.ok(fs.statSync('src/view/'+folder).isDirectory());assert.ok(index.includes('src/view/'+folder+'/CONFIG.md'));assert.ok(fs.existsSync(dir+'/README.md'));
 for(const file of fs.readdirSync(dir).filter(n=>n.endsWith('.md'))){
  for(const m of fs.readFileSync(dir+'/'+file,'utf8').matchAll(/\]\(([^)]+)\)/g)){if(/^[a-z]+:/.test(m[1]))continue;assert.ok(fs.existsSync(path.resolve(dir,m[1].split('#')[0])),file+' '+m[1]);count++}
 }
}
for(const p of ['design/architecture-preview.html','design/resource-market-preview.html']){
 const s=fs.readFileSync(p,'utf8');assert.ok(s.includes('location.hash'));assert.ok(fs.existsSync(path.resolve(path.dirname(p),s.match(/href="([^"]+)"/)[1])));
}
new vm.Script(fs.readFileSync(root+'/src/view/office/architecture-preview.html','utf8').match(/<script>([\s\S]*?)<\/script>/)[1]);
console.log('Source directory mappings, CONFIG coverage, '+count+' module links, two legacy targets/hash preservation and prototype script syntax PASS');
