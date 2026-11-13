import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {afterEach,expect,test} from 'vitest';
import {LlmProfiles,type LockedModelConfiguration,type SecretCipher} from '../src/logic/models/service';
import type {LlmDefinition} from '../src/logic/models';

const roots:string[]=[];
afterEach(async()=>{for(const root of roots.splice(0))await fs.rm(root,{recursive:true,force:true})});
const latch=()=>{let resolve!:()=>void;const promise=new Promise<void>(done=>resolve=done);return {promise,resolve}};
const definition=(name='原岗位'):LlmDefinition=>({name,api:'openai-completions',baseUrl:'http://localhost:1/v1',auth:'api-key',defaultModel:'model-a',models:[{id:'model-a',name:'A',enabled:true,contextWindow:32768,maxTokens:1024,reasoning:false}]});
async function setup(){const root=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-owner-model-'));roots.push(root);let decryptions=0;const cipher:SecretCipher={available:()=>true,encrypt:s=>Buffer.from(s).toString('base64'),decrypt:s=>{decryptions++;return Buffer.from(s,'base64').toString()}};const service=new LlmProfiles(path.join(root,'models.json'),cipher),saved=await service.save({profile:definition(),apiKey:'only-private-factory'});return {service,ref:{profileId:saved.selectedId!,modelId:'model-a'},get decryptions(){return decryptions}}}

test('公开多岗位快照持同一配置短锁，后到保存不能越过，且不解密',async()=>{
  const f=await setup(),entered=latch(),release=latch();let saved=false;
  const read=f.service.withConfigurations([f.ref,f.ref],async profiles=>{expect(profiles.map(p=>p.name)).toEqual(['原岗位','原岗位']);expect(JSON.stringify(profiles)).not.toMatch(/apiKey|encryptedKey|only-private-factory/);entered.resolve();await release.promise;expect(f.decryptions).toBe(0);return profiles});
  await entered.promise;const update=f.service.save({id:f.ref.profileId,profile:definition('后来配置')}).then(()=>{saved=true});
  await new Promise<void>(resolve=>setImmediate(resolve));expect(saved).toBe(false);release.resolve();await read;await update;
  expect((await f.service.configuration(f.ref.profileId,f.ref.modelId)).name).toBe('后来配置');expect(f.decryptions).toBe(0);
});

test('先到配置修改被下一领取捕获，解密仅在受控回调内发生一次',async()=>{
  const f=await setup();const saved=f.service.save({id:f.ref.profileId,profile:definition('先到配置')});let escaped!:LockedModelConfiguration;
  const result=await f.service.withRuntimeConfiguration(f.ref,async locked=>{escaped=locked;expect(locked.profile.name).toBe('先到配置');expect(f.decryptions).toBe(0);const first=locked.resolve();expect(locked.resolve()).toBe(first);return first});await saved;
  expect(result.profile.name).toBe('先到配置');expect(f.decryptions).toBe(1);expect(()=>escaped.resolve()).toThrowError(/已结束/);
  await f.service.save({id:f.ref.profileId,profile:definition('下次配置')});expect(result.profile.name).toBe('先到配置');expect(f.decryptions).toBe(1);
});

test('预算或停止在准备回调内拒绝时零解密并释放模型队列',async()=>{
  const f=await setup();await expect(f.service.withRuntimeConfiguration(f.ref,async()=>{throw Object.assign(Error('stopped before claim'),{code:'COLLABORATION_STOPPED'})})).rejects.toMatchObject({code:'COLLABORATION_STOPPED'});
  expect(f.decryptions).toBe(0);await f.service.save({id:f.ref.profileId,profile:definition('仍可保存')});expect((await f.service.list()).profiles[0].name).toBe('仍可保存');
});

test('显式模型缺失或禁用不回退默认供应商，原回调不会执行',async()=>{
  const f=await setup();let calls=0;const use=async()=>{calls++;return true};
  await expect(f.service.withRuntimeConfiguration({profileId:'',modelId:'model-a'},use)).rejects.toMatchObject({code:'LLM_REQUIRED'});
  await expect(f.service.withConfigurations([{...f.ref,modelId:'missing'}],use)).rejects.toMatchObject({code:'LLM_MODEL'});
  await f.service.remove(f.ref.profileId);await expect(f.service.withRuntimeConfiguration(f.ref,use)).rejects.toMatchObject({code:'LLM_REQUIRED'});expect(calls).toBe(0);expect(f.decryptions).toBe(0);
});
