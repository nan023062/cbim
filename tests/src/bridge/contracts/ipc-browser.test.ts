import {expect,it} from 'vitest';
import {build} from 'vite';
import {isBuiltin} from 'node:module';
import path from 'node:path';

it('当前公开通信契约可以在浏览器构建中使用，不传递加载 Node.js 实现',async()=>{
  const entries=Object.fromEntries(['desktop-engines','desktop-models','desktop-updates','discovery'].map(name=>[name,path.resolve('src/bridge/contracts/'+name+'.ts')]));
  const result=await build({
    configFile:false,logLevel:'silent',
    plugins:[{name:'reject-node-in-browser',enforce:'pre',resolveId(id){
      if(isBuiltin(id)||id==='electron')throw Error(`Browser IPC must not load ${id}`);
    }}],
    build:{write:false,minify:false,lib:{entry:entries,formats:['es']},rollupOptions:{external:[]}},
  });
  expect(Array.isArray(result)).toBe(true);
  const output=Array.isArray(result)?result[0]:result;
  expect('output' in output).toBe(true);
  if(!('output' in output))throw Error('Missing browser output');
  const chunks=output.output.filter(item=>item.type==='chunk');
  expect(chunks.filter(item=>item.isEntry)).toHaveLength(4);
  expect(chunks.some(item=>item.exports.includes('modelActionSchemas'))).toBe(true);
  expect(chunks.some(item=>item.exports.includes('desktopVersionLabel'))).toBe(true);
});
