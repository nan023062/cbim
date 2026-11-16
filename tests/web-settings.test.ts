import {expect,it} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {tempDirectory} from './support/temp-directory';
import {WebSettings} from '../src/logic/web/service';
const cipher={Available:()=>true,Encrypt:(value:string)=>Buffer.from(value).toString('base64'),Decrypt:(value:string)=>Buffer.from(value,'base64').toString()};
it('旧配置缺省允许浏览器读取，策略独立保存、重启保留且旧客户端不重置',async()=>{
  const f=await tempDirectory();try{
    const file=path.join(f.root,'web-policy.json');await fs.writeFile(file,JSON.stringify({revision:4,enabled:false}));
    const settings=new WebSettings(file);await settings.Init();expect(settings.Read().browserRobotsPolicy).toBe('allow');
    expect(await settings.Configure({revision:4,enabled:false,browserRobotsPolicy:'respect'})).toMatchObject({browserRobotsPolicy:'respect',hasKey:false});
    const restored=new WebSettings(file);await restored.Init();expect(restored.Read().browserRobotsPolicy).toBe('respect');
    expect((await restored.Configure({revision:5,enabled:false})).browserRobotsPolicy).toBe('respect');
    await expect(restored.Configure({revision:6,enabled:false,browserRobotsPolicy:'invalid'})).rejects.toThrow();
  }finally{await f.cleanup()}
});
it('搜索密钥加密落盘、并发版本冲突、重启读取及移除立即禁用',async()=>{
  const f=await tempDirectory();try{
    const file=path.join(f.root,'web.json'),settings=new WebSettings(file,cipher);await settings.Init();
    const view=await settings.Configure({revision:1,enabled:true,apiKey:'secret-search-key'});expect(view).toMatchObject({revision:2,enabled:true,hasKey:true});expect(JSON.stringify(view)).not.toContain('secret');expect(await fs.readFile(file,'utf8')).not.toContain('secret-search-key');
    await expect(settings.Configure({revision:1,enabled:false})).rejects.toMatchObject({code:'WEB_SETTINGS_CONFLICT'});
    const restored=new WebSettings(file,cipher);await restored.Init();expect(restored.Resolve()).toBe('secret-search-key');await restored.Configure({revision:2,enabled:false,clearKey:true});expect(()=>restored.Resolve()).toThrow();expect(await fs.readFile(file,'utf8')).not.toContain(cipher.Encrypt('secret-search-key'));
  }finally{await f.cleanup()}
});
it('安全存储不可用时拒绝写密钥，失败不创建配置文件',async()=>{
  const f=await tempDirectory();try{
    const settings=new WebSettings(path.join(f.root,'unsafe.json'),{...cipher,Available:()=>false});await expect(settings.Configure({revision:1,enabled:true,apiKey:'secret'})).rejects.toMatchObject({code:'WEB_SECRET_UNAVAILABLE'});await expect(fs.access(path.join(f.root,'unsafe.json'))).rejects.toThrow();
  }finally{await f.cleanup()}
});
