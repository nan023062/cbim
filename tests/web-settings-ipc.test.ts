import {expect,it} from 'vitest';
import {fixture} from './helpers';

it('真实 IPC 默认允许读正文，保存严格策略且只公开凭据摘要',async()=>{
  const f=await fixture();try{
    expect(await f.app.dispatch('web.settings')).toMatchObject({provider:'brave',enabled:false,hasKey:false,browserRobotsPolicy:'allow'});
    await expect(f.app.dispatch('web.configure',{revision:1,enabled:false,url:'http://localhost'} as any)).rejects.toThrow();
    expect(await f.app.dispatch('web.configure',{revision:1,enabled:false})).toMatchObject({revision:2});
    expect(await f.app.dispatch('web.configure',{revision:2,enabled:false,browserRobotsPolicy:'respect'})).toMatchObject({revision:3,browserRobotsPolicy:'respect'});
  }finally{await f.cleanup()}
});
