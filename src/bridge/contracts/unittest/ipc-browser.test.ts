import {expect,it} from 'vitest';
import {build} from 'vite';
import {isBuiltin} from 'node:module';
import path from 'node:path';

it('全部 IPC Schema 可以在浏览器构建中使用，不传递加载 Node.js 实现',async()=>{
  const result=await build({
    configFile:false,logLevel:'silent',
    plugins:[{name:'reject-node-in-browser',enforce:'pre',resolveId(id){
      if(isBuiltin(id)||id==='electron')throw Error(`Browser IPC must not load ${id}`);
    }}],
    build:{write:false,minify:false,lib:{entry:path.resolve('src/bridge/contracts/ipc-call.ts'),formats:['es']},rollupOptions:{external:[]}},
  });
  expect(Array.isArray(result)).toBe(true);
  const output=Array.isArray(result)?result[0]:result;
  expect('output' in output&&output.output.some(item=>item.type==='chunk'&&item.exports.includes('parseIpcRequest'))).toBe(true);
});
