import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {afterEach,expect,test} from 'vitest';
import {LlmProfiles,type SecretCipher} from '../src/backend/main/persistence/settings/llm-profiles';
import type {LlmDefinition} from '../src/backend/core/brain/llm/config';
const roots:string[]=[];
afterEach(async()=>{for(const root of roots.splice(0))await fs.rm(root,{recursive:true,force:true})});
const cipher:SecretCipher={available:()=>true,encrypt:s=>Buffer.from(s).toString('base64'),decrypt:s=>Buffer.from(s,'base64').toString()};
const profile=(baseUrl='http://localhost:1234/v1'):LlmDefinition=>({name:'测试供应商',api:'openai-completions',baseUrl,auth:'none',defaultModel:'model-a',models:[{id:'model-a',name:'A',enabled:true,contextWindow:32768,maxTokens:1024,reasoning:false},{id:'model-b',name:'B',enabled:false,contextWindow:65536,maxTokens:2048,reasoning:true}]});
async function fixture(encryption:SecretCipher|undefined=cipher){const root=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-models-'));roots.push(root);const filename=path.join(root,'llm.json');return {filename,service:new LlmProfiles(filename,encryption)}}
test('supplier credentials stay encrypted; model defaults and disabled state survive reload',async()=>{
  const {service,filename}=await fixture();const p={...profile(),auth:'api-key' as const};const s=await service.save({profile:p,apiKey:'secret-for-test'}),id=s.selectedId!;
  expect(JSON.stringify(s)).not.toContain('secret-for-test');expect(JSON.stringify(s)).not.toContain('encryptedKey');expect(await fs.readFile(filename,'utf8')).not.toContain('secret-for-test');
  const reloaded=new LlmProfiles(filename,cipher);expect((await reloaded.resolve()).apiKey).toBe('secret-for-test');expect((await reloaded.resolve()).profile.model).toBe('model-a');
  await expect(service.resolve(id,'model-b')).rejects.toThrow('禁用');
  await service.save({id,profile:{...p,name:'改名'}});expect((await service.resolve()).apiKey).toBe('secret-for-test');
  await expect(service.save({id,profile:{...p,baseUrl:'https://other.example/v1'}})).rejects.toThrow('重新输入');
  await service.remove(id);await expect(service.resolve()).rejects.toThrow('默认大模型');
});
test('no plaintext fallback and decrypt failure does not expose cipher text',async()=>{
  const {service,filename}=await fixture({available:()=>false,encrypt:()=>{throw Error('must not call')},decrypt:()=>''});
  await expect(service.save({profile:{...profile(),auth:'api-key'},apiKey:'key'})).rejects.toThrow('系统加密');expect(await service.list()).toMatchObject({profiles:[]});
  const saved=await new LlmProfiles(filename,cipher).save({profile:{...profile(),auth:'api-key'},apiKey:'private'});
  await expect(new LlmProfiles(filename,{...cipher,decrypt:()=>{throw Error('private')}}).resolve(saved.selectedId)).rejects.toThrow('无法解密');
});
test('explicit registration configuration shares resolved public fields without decryption or default fallback',async()=>{
  let decryptions=0;const encryption={...cipher,decrypt:(value:string)=>{decryptions++;return cipher.decrypt(value)}};
  const {service,filename}=await fixture(encryption),p={...profile(),auth:'api-key' as const,models:[{...profile().models[0],vision:true,thinkingLevel:'low' as const,workingContextWindow:16000,compactionPercent:70,pricing:{input:1,output:2,cacheRead:0.2,cacheWrite:0.3}},profile().models[1]]};
  const saved=await service.save({profile:p,apiKey:'private-registration-test-key'}),id=saved.selectedId!;
  const snapshot=await service.configuration(id,'model-a');expect(decryptions).toBe(0);
  expect(snapshot).toEqual((await service.resolve(id,'model-a')).profile);expect(decryptions).toBe(1);
  const unavailable=new LlmProfiles(filename,{...cipher,available:()=>false,decrypt:()=>{throw Error('must not decrypt')}});
  expect(await unavailable.configuration(id,'model-a')).toEqual(snapshot);
  expect(JSON.stringify(snapshot)).not.toMatch(/private-registration-test-key|apiKey|encryptedKey|hasKey|selectedId/);
  await expect(service.configuration('', 'model-a')).rejects.toMatchObject({code:'LLM_REQUIRED'});
  await expect(service.configuration(id,'model-b')).rejects.toMatchObject({code:'LLM_MODEL'});
});
test('selection and concurrent saves preserve providers',async()=>{
  const {service}=await fixture();await Promise.all([service.save({profile:profile()}),service.save({profile:{...profile(),name:'second'}})]);
  const s=await service.list();expect(s.profiles).toHaveLength(2);await service.select(s.profiles[1].id);expect((await service.resolve()).profile.name).toBe('second');
  await service.remove(s.profiles[1].id);expect((await service.list()).selectedId).toBe(s.profiles[0].id);
});
test('invalid identities, duplicate model IDs, capacity and unsafe endpoints are rejected',async()=>{
  const {service}=await fixture();for(const p of [{...profile(),baseUrl:'http://external.example/v1'},{...profile(),baseUrl:'https://user:secret@example.com'},{...profile(),defaultModel:'model-b'},{...profile(),models:[profile().models[0],profile().models[0]]},{...profile(),models:[{...profile().models[0],maxTokens:50000}]}])await expect(service.save({profile:p})).rejects.toThrow();
  expect((await service.list()).profiles).toHaveLength(0);
});
test.each(['openai-completions','openai-responses','anthropic-messages'] as const)('%s discovery and short connection test use correct routes without project data',async api=>{
  const requests:{url:string;headers:http.IncomingHttpHeaders;body:any}[]=[];
  const server=http.createServer(async(req,res)=>{let text='';for await(const c of req)text+=c;const body=text?JSON.parse(text):undefined;requests.push({url:req.url!,headers:req.headers,body});res.setHeader('Content-Type','application/json');res.end(JSON.stringify(req.method==='GET'?{data:[{id:'model-a'},{id:'model-a'},{id:'model-b'}]}:api==='anthropic-messages'?{content:[{type:'text',text:'OK'}]}:api==='openai-responses'?{output:[{type:'message',content:[{type:'output_text',text:'OK'}]}]}:{choices:[{message:{content:'OK'}}]}))});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{const {service}=await fixture();const p={...profile(`http://127.0.0.1:${(server.address() as any).port}/v1`),api,auth:'api-key' as const};const s=await service.save({profile:p,apiKey:'private-key'});
    expect(await service.discover({id:s.selectedId,connection:{name:p.name,api,auth:p.auth,baseUrl:p.baseUrl}})).toEqual(['model-a','model-b']);
    expect(await service.test(s.selectedId!)).toMatchObject({ok:true,model:'model-a'});expect(requests[0].url).toBe('/v1/models');
    expect(requests[1].url).toBe(api==='anthropic-messages'?'/v1/messages':api==='openai-responses'?'/v1/responses':'/v1/chat/completions');
    expect(requests[1].headers[api==='anthropic-messages'?'x-api-key':'authorization']).toBe(api==='anthropic-messages'?'private-key':'Bearer private-key');
    expect(JSON.stringify(requests[1].body)).toContain('Reply with OK.');expect(JSON.stringify(requests[1].body)).not.toContain('.cbim');
  }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}
});
test('upstream secret error bodies and redirects are not returned to renderer',async()=>{
  const server=http.createServer((req,res)=>{if(req.url?.endsWith('/models'))res.writeHead(302,{location:'http://localhost:1/secret'}).end();else res.writeHead(401).end('private-key upstream body')});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{const {service}=await fixture();const p=profile(`http://127.0.0.1:${(server.address() as any).port}/v1`);const s=await service.save({profile:p});await expect(service.test(s.selectedId!)).rejects.toThrow('HTTP 401');await expect(service.discover({connection:{name:p.name,api:p.api,baseUrl:p.baseUrl,auth:p.auth}})).rejects.toThrow('连接失败');}
  finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}
});
