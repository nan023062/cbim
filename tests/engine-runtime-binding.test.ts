import {it,expect,vi} from 'vitest';
import path from 'node:path';
import {runtimeFixture,digest} from './runtime-fixture';
import {pinRuntimeEngine} from '../src/backend/engines/runtime-binding';
import type {AgentEngine,EngineContext} from '../src/backend/core/execution/types';
it('pins native sessions before their binding receipt and rejects a different package before SDK startup',async()=>{
  const f=await runtimeFixture();try{
    const runtime={root:f.root,entry:'engine',version:'1.5.0',identity:digest('pi-a')},home=path.join(f.root,'home');
    const engine:AgentEngine={kind:'pi',start:vi.fn(async context=>context.emit({type:'session.bound',data:{sessionId:context.nativeSessionId}})),run:vi.fn(async()=>({status:'completed' as const})),stop:vi.fn(async()=>{}),close:vi.fn(async()=>{})};
    const context={nativeSessionId:'session',emit:vi.fn(async()=>{})} as unknown as EngineContext;
    await pinRuntimeEngine(engine,home,runtime).start(context);expect(context.emit).toHaveBeenCalledOnce();
    await pinRuntimeEngine(engine,home,runtime).start({...context,sessionFile:'private-history'});expect(engine.start).toHaveBeenCalledTimes(2);
    await expect(pinRuntimeEngine(engine,home,{...runtime,identity:digest('pi-b')}).start({...context,sessionFile:'private-history'})).rejects.toThrow(/引擎包已变化/);expect(engine.start).toHaveBeenCalledTimes(2);
    const fresh={...context,nativeSessionId:'new-session'};await pinRuntimeEngine(engine,home,{...runtime,identity:digest('pi-b')}).start({...fresh,emit:async()=>{}});
    // 新会话有独立身份，可以使用新包；旧会话记录和原生文件保持不变。
    expect(engine.start).toHaveBeenCalledTimes(3);
  }finally{await f.cleanup()}
});
it('legacy migration accepts only the known original engine version, and wrappers preserve optional steering',async()=>{
  const f=await runtimeFixture();try{
    const engine:AgentEngine={kind:'codex',start:vi.fn(async()=>{}),run:vi.fn(async()=>({status:'completed' as const})),stop:vi.fn(async()=>{}),close:vi.fn(async()=>{}),steer:vi.fn(async()=>{})};
    const context={sessionFile:'old-native',nativeSessionId:'old-id',emit:vi.fn()} as unknown as EngineContext,runtime={root:f.root,entry:'engine',version:'0.167.0',identity:digest('engine')};
    await pinRuntimeEngine(engine,f.root,runtime).start(context);expect(engine.start).toHaveBeenCalledOnce();
    await expect(pinRuntimeEngine(engine,f.root,{...runtime,version:'0.168.0'}).start(context)).rejects.toThrow(/兼容记录/);expect(engine.start).toHaveBeenCalledOnce();
    const wrapped=pinRuntimeEngine(engine,f.root,runtime);await wrapped.steer!('message',[],new AbortController().signal);expect(engine.steer).toHaveBeenCalledOnce();expect(pinRuntimeEngine(engine,f.root)).toBe(engine);
  }finally{await f.cleanup()}
});
