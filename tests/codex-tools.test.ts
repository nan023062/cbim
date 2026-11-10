import {expect,test} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {codexFixture} from './codex-fixture';

test.each(['internal','read','write','bash'] as const)('real Codex routes %s through original call identity and persists one result',async tool=>{
  const f=await codexFixture({tool});try{
    await f.engine.start(f.context);expect(await f.engine.run('Use the provided tool')).toEqual({status:'completed'});
    expect(f.calls).toEqual([{id:f.callId,name:tool==='internal'?'cbim_test_read':tool,input:f.input}]);
    expect(f.events.filter(event=>event.type==='tool.finished')).toHaveLength(1);expect(f.events.find(event=>event.type==='tool.finished')?.data).toMatchObject({id:f.callId,isError:false});
    if(tool==='internal')expect(f.invocations).toEqual([{id:f.callId,name:'cbim_test_read',args:f.input}]);
    if(tool==='write')expect(await fs.readFile(path.join(f.cwd,'written.txt'),'utf8')).toBe('Codex wrote this');
    if(tool==='bash')expect(JSON.stringify(f.events.find(event=>event.type==='tool.finished')?.data.result)).toContain('cbim-codex-command');
    expect(f.errors).toEqual([]);
  }finally{await f.cleanup()}
},45000);

test.each([false,'throw'] as const)('real Codex Write remains blocked when authorization is %s',async allow=>{
  const f=await codexFixture({tool:'write',allow});try{
    await f.engine.start(f.context);const result=await f.engine.run('Write a file').catch(()=>({status:'failed'}));
    if(allow==='throw')expect(result.status).toBe('failed');expect(f.calls).toHaveLength(1);expect(await fs.access(path.join(f.cwd,'written.txt')).then(()=>true,()=>false)).toBe(false);expect(f.events.some(event=>event.type==='tool.started')).toBe(false);
  }finally{await f.cleanup()}
},45000);
