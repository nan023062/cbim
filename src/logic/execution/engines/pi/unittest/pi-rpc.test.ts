import {it,expect} from 'vitest';
import path from 'node:path';
import {PiRpc} from '../rpc';

it('RPC preserves split JSON records and Unicode separators; correlates concurrent responses',async()=>{
  const events:any[]=[];const rpc=new PiRpc(event=>events.push(event),()=>{});
  rpc.Start({command:process.execPath,args:[path.resolve('src/logic/execution/engines/pi/unittest/support/pi-rpc-child.mjs')]},process.cwd(),[],process.env);
  try{
    const [one,two]=await Promise.all([rpc.Request('one'),rpc.Request('two')]);expect(one.echo).toBe('one');expect(two.echo).toBe('two');
    await rpc.Request('unicode');expect(events).toEqual([{type:'message',text:'first\u2028second\u2029third'}]);
    await expect(rpc.Request('never',{},25)).rejects.toThrow('不自动重放');
    expect((await rpc.Request('still-alive')).echo).toBe('still-alive');
  }finally{await rpc.Close()}
});

it('process loss rejects every in-flight RPC instead of reporting success',async()=>{
  const rpc=new PiRpc(()=>{},()=>{});
  rpc.Start({command:process.execPath,args:[path.resolve('src/logic/execution/engines/pi/unittest/support/pi-rpc-child.mjs')]},process.cwd(),[],process.env);
  try{const pending=rpc.Request('never');const killed=rpc.Request('crash');const results=await Promise.allSettled([pending,killed]);expect(results.every(r=>r.status==='rejected')).toBe(true)}finally{await rpc.Close()}
});
