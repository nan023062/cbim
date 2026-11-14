import {test,expect} from 'vitest';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
test('pinned Pi clamps output against declared capacity minus input and safety reserve',async()=>{
 const {clampMaxTokensToContext}=await import(pathToFileURL(path.resolve('node_modules/@earendil-works/pi-ai/dist/api/simple-options.js')).href);
 const context={messages:[{role:'user',content:'word '.repeat(16000),timestamp:Date.now()}]};
 const small=clampMaxTokensToContext({contextWindow:32768},context,16384);
 const real=clampMaxTokensToContext({contextWindow:1048576},context,16384);
 expect(small).toBeLessThan(16384);expect(real).toBe(16384);
});
