import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {afterEach,expect,test} from 'vitest';
import {definition,type LlmDefinition} from '../../../../src/logic/models';
import {LlmProfiles,type LockedModelOperations} from '../../../../src/logic/models/service';

const roots:string[]=[];
afterEach(async()=>{for(const root of roots.splice(0)){if(path.dirname(root)!==path.resolve(os.tmpdir())||!path.basename(root).startsWith('cbim-model-roles-'))throw Error('unexpected path');await fs.rm(root,{recursive:true,force:true})}});
const value:LlmDefinition={name:'Provider',api:'openai-completions',baseUrl:'http://localhost:1/v1',auth:'api-key',defaultModel:'chat',models:[{id:'chat',name:'Chat',enabled:true,contextWindow:8192,maxTokens:1024,reasoning:false}],embedding:{api:'openai-embeddings',baseUrl:'http://localhost:2/v1',models:[{id:'vector',name:'Vector',enabled:true,inputTokens:8192,dimensions:1536,inputPrice:0.02}]}};
async function fixture(){const root=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-model-roles-'));roots.push(root);let decrypted=0;const profiles=new LlmProfiles(path.join(root,'models.json'),{available:()=>true,encrypt:value=>'encrypted:'+value,decrypt:value=>{decrypted++;return value.slice(10)}});const saved=await profiles.save({profile:value,apiKey:'private-key'});return {profiles,id:saved.selectedId!,filename:path.join(root,'models.json'),decryptions:()=>decrypted}}

test('生成与向量操作同一次读取捕获，向量快照没有生成输出字段，退出回调后不能解析凭据',async()=>{
  const f=await fixture();let escaped!:LockedModelOperations;
  const bytes=await fs.readFile(f.filename,'utf8');
  await f.profiles.withModelOperations([{profileId:f.id,modelId:'chat'},{kind:'embedding',profileId:f.id,modelId:'vector'}],async locked=>{
    escaped=locked;expect(f.decryptions()).toBe(0);
    expect(locked.profiles[0]).toMatchObject({model:'chat',maxTokens:1024});expect(locked.profiles[0]).not.toHaveProperty('embedding');
    expect(locked.profiles[1]).toMatchObject({kind:'embedding',model:'vector',dimensions:1536,inputTokens:8192,inputPrice:0.02});
    expect(locked.profiles[1]).not.toHaveProperty('maxTokens');expect(locked.profiles[1]).not.toHaveProperty('contextWindow');
    expect(JSON.stringify(locked.profiles)).not.toMatch(/private-key|encryptedKey|apiKey/);
    const first=locked.resolve(1);expect(first.apiKey).toBe('private-key');expect(locked.resolve(1)).toBe(first);expect(f.decryptions()).toBe(1);
  });
  expect(()=>escaped.resolve(1)).toThrow(/已结束/);expect(await fs.readFile(f.filename,'utf8')).toBe(bytes);
});

test('多个角色共用配置短锁；保存不能插入快照之间，停止回调不解析任何密钥',async()=>{
  const f=await fixture();let enter!:()=>void,release!:()=>void,updated=false;
  const ready=new Promise<void>(resolve=>enter=resolve),gate=new Promise<void>(resolve=>release=resolve);
  const reading=f.profiles.withModelOperations([{profileId:f.id,modelId:'chat'},{kind:'embedding',profileId:f.id,modelId:'vector'}],async locked=>{enter();await gate;expect(locked.profiles.map(p=>p.name)).toEqual(['Provider','Provider']);throw Error('stopped')});
  const rejected=expect(reading).rejects.toThrow('stopped');await ready;
  const updating=f.profiles.save({id:f.id,profile:{...value,name:'Changed'}}).then(()=>updated=true);
  await new Promise<void>(resolve=>setImmediate(resolve));expect(updated).toBe(false);release();await rejected;await updating;expect(f.decryptions()).toBe(0);
});

test('只有向量模型的供应商不需要伪造生成模型或默认型号；禁用或错误操作不能回退',async()=>{
  const f=await fixture();await f.profiles.save({id:f.id,profile:{...value,models:[],defaultModel:''}});
  await expect(f.profiles.resolve(f.id)).rejects.toMatchObject({code:'LLM_MODEL'});
  await f.profiles.withModelOperations([{kind:'embedding',profileId:f.id,modelId:'vector'}],async locked=>expect(locked.profiles[0]).toMatchObject({kind:'embedding'}));
  await expect(f.profiles.withModelOperations([{kind:'embedding',profileId:f.id,modelId:'chat'}],async()=>{})).rejects.toMatchObject({code:'LLM_MODEL'});
  await expect(f.profiles.withModelOperations([{kind:'unknown' as 'embedding',profileId:f.id,modelId:'vector'}],async()=>{})).rejects.toMatchObject({code:'LLM_MODEL_ROLE'});
  expect(definition.safeParse({...value,models:[],defaultModel:'',embedding:undefined}).success).toBe(false);
  expect(definition.safeParse({...value,embedding:{...value.embedding,models:[{...value.embedding!.models[0],maxTokens:100}]}}).success).toBe(false);
});

test('新增或改变向量凭据目标要求重输密钥，纯改维度和价格不复制凭据',async()=>{
  const f=await fixture(),changed={...value,embedding:{...value.embedding!,baseUrl:'https://other.example/v1'}};
  await expect(f.profiles.save({id:f.id,profile:changed})).rejects.toMatchObject({code:'KEY_REQUIRED'});
  await f.profiles.save({id:f.id,profile:{...value,embedding:{...value.embedding!,models:[{...value.embedding!.models[0],dimensions:512,inputPrice:0}]}}});
  expect((await f.profiles.list()).profiles[0].embedding?.models[0].dimensions).toBe(512);expect(f.decryptions()).toBe(0);
});
