import {expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {GlobalRunAdmission} from '../../../execution/admission/run-admission';
import {AdmissionSettings,type AdmissionSettingsStorage} from '../admission-settings';

it('默认4可靠保存后切换，重开保留版本和上限；设置读取不生成占用',async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-admission-settings-'));
  try{
    const filename=path.join(directory,'run-admission.json'),admission=new GlobalRunAdmission(),settings=new AdmissionSettings(filename,admission);
    await settings.Init();expect(settings.Read()).toEqual({revision:1,maxConcurrentRuns:4});
    expect(await settings.Configure({revision:1,maxConcurrentRuns:1})).toEqual({revision:2,maxConcurrentRuns:1});
    expect(JSON.parse(await fs.readFile(filename,'utf8'))).toEqual({version:1,policy:{revision:2,maxConcurrentRuns:1}});
    const fresh=new GlobalRunAdmission(),reopened=new AdmissionSettings(filename,fresh);await reopened.Init();
    expect(reopened.Read()).toEqual(settings.Read());expect(fresh.Snapshot().occupied).toEqual([]);expect(fresh.Snapshot().waiting).toEqual([]);
  }finally{await fs.rm(directory,{recursive:true,force:true})}
});

it('串行版本校验不覆盖其它窗口，严格输入拒绝未保存的越界或伪造字段',async()=>{
  const write=vi.fn(async()=>{}),storage:AdmissionSettingsStorage={Read:async()=>{throw Object.assign(Error('missing'),{code:'ENOENT'})},Write: write};
  const settings=new AdmissionSettings('unused',new GlobalRunAdmission(),storage);await settings.Init();
  const first=settings.Configure({revision:1,maxConcurrentRuns:2}),second=settings.Configure({revision:1,maxConcurrentRuns:3});
  await first;await expect(second).rejects.toMatchObject({code:'ADMISSION_SETTINGS_CONFLICT'});
  for(const input of [{revision:2,maxConcurrentRuns:0},{revision:2,maxConcurrentRuns:33},{revision:2,maxConcurrentRuns:1.2},{revision:2,maxConcurrentRuns:2,allow:true}])await expect(settings.Configure(input)).rejects.toMatchObject({code:'ADMISSION_SETTINGS_INPUT'});
  expect(write).toHaveBeenCalledTimes(1);expect(settings.Read()).toEqual({revision:2,maxConcurrentRuns:2});
});

it('写盘未完成或失败时不改变生效策略，失败后原版本可明确重试',async()=>{
  let finish!:(error?:Error)=>void;
  const write=vi.fn(()=>new Promise<void>((resolve,reject)=>{finish=error=>error?reject(error):resolve()}));
  const admission=new GlobalRunAdmission(),settings=new AdmissionSettings('unused',admission,{Read:async()=>{throw Object.assign(Error('missing'),{code:'ENOENT'})},Write: write});await settings.Init();
  const pending=settings.Configure({revision:1,maxConcurrentRuns:1});await Promise.resolve();
  expect(admission.Snapshot().policy.maxConcurrentRuns).toBe(4);finish(Error('disk unavailable'));
  await expect(pending).rejects.toMatchObject({code:'ADMISSION_SETTINGS_WRITE'});expect(settings.Read().revision).toBe(1);
  const retry=settings.Configure({revision:1,maxConcurrentRuns:1});await Promise.resolve();finish();await retry;
  expect(settings.Read()).toEqual({revision:2,maxConcurrentRuns:1});
});

it('损坏文件明确失败且不覆盖，重复初始化不重置活动配额',async()=>{
  const write=vi.fn(async()=>{}),bad=new AdmissionSettings('unused',new GlobalRunAdmission(),{Read:async()=>'{broken',Write: write});
  await expect(bad.Init()).rejects.toMatchObject({code:'ADMISSION_SETTINGS_INVALID'});expect(write).not.toHaveBeenCalled();
  const read=vi.fn(async()=>JSON.stringify({version:1,policy:{revision:9,maxConcurrentRuns:3}})),settings=new AdmissionSettings('unused',new GlobalRunAdmission(),{Read: read,Write: write});
  await settings.Init();await settings.Init();expect(read).toHaveBeenCalledTimes(1);expect(settings.Read()).toEqual({revision:9,maxConcurrentRuns:3});
});
