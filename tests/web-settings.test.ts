import {expect,it} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './helpers';
import {WebSettings} from '../src/backend/main/persistence/settings/web-settings';
const cipher={available:()=>true,encrypt:(value:string)=>Buffer.from(value).toString('base64'),decrypt:(value:string)=>Buffer.from(value,'base64').toString()};
it('搜索密钥加密落盘、并发版本冲突、重启读取及移除立即禁用',async()=>{
  const f=await fixture();try{
    const file=path.join(f.temp,'web.json'),settings=new WebSettings(file,cipher);await settings.init();
    const view=await settings.configure({revision:1,enabled:true,apiKey:'secret-search-key'});expect(view).toMatchObject({revision:2,enabled:true,hasKey:true});expect(JSON.stringify(view)).not.toContain('secret');expect(await fs.readFile(file,'utf8')).not.toContain('secret-search-key');
    await expect(settings.configure({revision:1,enabled:false})).rejects.toMatchObject({code:'WEB_SETTINGS_CONFLICT'});
    const restored=new WebSettings(file,cipher);await restored.init();expect(restored.resolve()).toBe('secret-search-key');await restored.configure({revision:2,enabled:false,clearKey:true});expect(()=>restored.resolve()).toThrow();expect(await fs.readFile(file,'utf8')).not.toContain(cipher.encrypt('secret-search-key'));
  }finally{await f.cleanup()}
});
it('安全存储不可用拒绝写密钥，真实 IPC 只公开摘要且拒绝未知字段',async()=>{
  const f=await fixture();try{
    const settings=new WebSettings(path.join(f.temp,'unsafe.json'),{...cipher,available:()=>false});await expect(settings.configure({revision:1,enabled:true,apiKey:'secret'})).rejects.toMatchObject({code:'WEB_SECRET_UNAVAILABLE'});await expect(fs.access(path.join(f.temp,'unsafe.json'))).rejects.toThrow();
    expect(await f.app.dispatch('web.settings')).toMatchObject({provider:'brave',enabled:false,hasKey:false});
    await expect(f.app.dispatch('web.configure',{revision:1,enabled:false,url:'http://localhost'} as any)).rejects.toThrow();
    expect(await f.app.dispatch('web.configure',{revision:1,enabled:false})).toMatchObject({revision:2});
  }finally{await f.cleanup()}
});
