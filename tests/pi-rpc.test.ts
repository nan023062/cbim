import {it,expect} from 'vitest';
import path from 'node:path';
import {PiRpc} from '../src/logic/execution/engines/pi/rpc';

it('RPC preserves split JSON records and Unicode separators; correlates concurrent responses',async()=>{
  const events:any[]=[];const rpc=new PiRpc(event=>events.push(event),()=>{});
  rpc.start({command:process.execPath,args:[path.resolve('tests/pi-rpc-child.mjs')]},process.cwd(),[],process.env);
  try{
    const [one,two]=await Promise.all([rpc.request('one'),rpc.request('two')]);expect(one.echo).toBe('one');expect(two.echo).toBe('two');
    await rpc.request('unicode');expect(events).toEqual([{type:'message',text:'first\u2028second\u2029third'}]);
    await expect(rpc.request('never',{},25)).rejects.toThrow('不自动重放');
    expect((await rpc.request('still-alive')).echo).toBe('still-alive');
  }finally{await rpc.close()}
});

it('process loss rejects every in-flight RPC instead of reporting success',async()=>{
  const rpc=new PiRpc(()=>{},()=>{});
  rpc.start({command:process.execPath,args:[path.resolve('tests/pi-rpc-child.mjs')]},process.cwd(),[],process.env);
  try{const pending=rpc.request('never');const killed=rpc.request('crash');const results=await Promise.allSettled([pending,killed]);expect(results.every(r=>r.status==='rejected')).toBe(true)}finally{await rpc.close()}
});
