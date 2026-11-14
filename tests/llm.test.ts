import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {afterEach,expect,test} from 'vitest';
import {LlmProfiles,type SecretCipher} from '../src/logic/models/service';
import type {LlmDefinition,ModelConnectionRequirement} from '../src/logic/models';
const messages:ModelConnectionRequirement={supportedApis:['anthropic-messages'],fallbackApi:'anthropic-messages'};
const responses:ModelConnectionRequirement={supportedApis:['openai-responses'],fallbackApi:'openai-responses'};
const chat:ModelConnectionRequirement={supportedApis:['openai-completions']};
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

test('一份加密 Key 解析三种官方接口，岗位与运行快照一致且旧文件字节不变',async()=>{
  const {service,filename}=await fixture();
  const p={...profile('https://api.deepseek.com/v1'),auth:'api-key' as const};
  const saved=await service.save({profile:p,apiKey:'one-key-only'}),id=saved.selectedId!,bytes=await fs.readFile(filename,'utf8');
  const pi=await service.configuration(id,'model-a');
  const claude=await service.configuration(id,'model-a',messages);
  const codex=await service.resolve(id,'model-a',responses);
  expect(pi.api).toBe('openai-completions');expect(pi).not.toHaveProperty('engine');
  expect(claude).toMatchObject({api:'anthropic-messages',baseUrl:'https://api.deepseek.com/anthropic',model:'model-a'});
  expect(codex).toMatchObject({apiKey:'one-key-only',profile:{api:'openai-responses',baseUrl:'https://api.deepseek.com',model:'model-a'}});
  await service.withRuntimeConfiguration({profileId:id,modelId:'model-a',connection:messages},async locked=>{
    expect(locked.profile).toEqual(claude);expect(locked.resolve()).toEqual({profile:claude,apiKey:'one-key-only'});
  });
  expect(JSON.stringify(claude)).not.toMatch(/autoDetect|alternateConnections|apiKey|encryptedKey/);
  expect(await fs.readFile(filename,'utf8')).toBe(bytes);expect((await service.list()).profiles).toHaveLength(1);
});

test('新增自定义凭据目标必须重输 Key；重命名、模型范围和删除接口不复制凭据',async()=>{
  const {service,filename}=await fixture(),p={...profile(),auth:'api-key' as const};
  const saved=await service.save({profile:p,apiKey:'shared-key'}),id=saved.selectedId!;
  const extended:LlmDefinition={...p,alternateConnections:[{api:'anthropic-messages',baseUrl:'https://other.example/anthropic'}]};
  const before=await fs.readFile(filename,'utf8');
  await expect(service.save({id,profile:extended})).rejects.toMatchObject({code:'KEY_REQUIRED'});
  expect(await fs.readFile(filename,'utf8')).toBe(before);
  await service.save({id,profile:extended,apiKey:'shared-key'});
  const scoped:LlmDefinition={...extended,name:'Renamed',alternateConnections:[{...extended.alternateConnections![0],modelIds:['model-a']}]};
  await service.save({id,profile:scoped});
  expect((await service.resolve(id,'model-a',messages)).apiKey).toBe('shared-key');
  expect(JSON.parse(await fs.readFile(filename,'utf8')).profiles[0].alternateConnections[0]).not.toHaveProperty('encryptedKey');
  await service.save({id,profile:p});
  await expect(service.resolve(id,'model-a',messages)).rejects.toMatchObject({code:'LLM_CONNECTION_API'});
});

test('按协议需求测试真实 HTTP 端点与鉴权；失败不改目录、不尝试其他端点',async()=>{
  const requests:{url:string;headers:http.IncomingHttpHeaders;body:any}[]=[];
  let rejectClaude=false;
  const server=http.createServer(async(req,res)=>{
    let raw='';for await(const part of req)raw+=part;
    requests.push({url:req.url!,headers:req.headers,body:JSON.parse(raw)});
    if(rejectClaude&&req.url==='/anthropic/v1/messages'){res.writeHead(401).end('private-server-body');return}
    res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify(req.url==='/anthropic/v1/messages'?{content:[{type:'text',text:'OK'}]}:req.url==='/responses'?{output:[{type:'message',content:[{type:'output_text',text:'OK'}]}]}:{choices:[{message:{content:'OK'}}]}));
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const {service,filename}=await fixture(),url=`http://127.0.0.1:${(server.address() as any).port}`;
    const p:LlmDefinition={...profile(url+'/v1'),auth:'api-key',alternateConnections:[{api:'anthropic-messages',baseUrl:url+'/anthropic'},{api:'openai-responses',baseUrl:url}]};
    const saved=await service.save({profile:p,apiKey:'shared-key'}),id=saved.selectedId!,bytes=await fs.readFile(filename,'utf8');
    for(const connection of [chat,messages,responses]){const result=await service.test(id,'model-a',connection);expect(result).toMatchObject({ok:true,model:'model-a'});expect(result).not.toHaveProperty('engine')}
    expect(requests.map(request=>request.url)).toEqual(['/v1/chat/completions','/anthropic/v1/messages','/responses']);
    expect(requests[0].headers.authorization).toBe('Bearer shared-key');expect(requests[1].headers['x-api-key']).toBe('shared-key');expect(requests[1].headers.authorization).toBeUndefined();expect(requests[2].headers.authorization).toBe('Bearer shared-key');
    expect(requests.every(request=>request.body.model==='model-a')).toBe(true);
    rejectClaude=true;await expect(service.test(id,'model-a',messages)).rejects.toThrow('HTTP 401');
    expect(requests).toHaveLength(4);expect(await fs.readFile(filename,'utf8')).toBe(bytes);expect(await service.list()).toEqual(saved);
  }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}
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

test.each([401,403,404,429,500])('模型诊断保留端点与 HTTP %s，错误不隐藏目录或泄露供应商正文',async status=>{
  const server=http.createServer((_req,res)=>res.writeHead(status).end('private-upstream-key'));
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const {service}=await fixture(),p={...profile(`http://127.0.0.1:${(server.address() as any).port}/v1`),api:'anthropic-messages' as const};
    const saved=await service.save({profile:p});
    const error=await service.test(saved.selectedId!).then(()=>{throw Error('expected failure')},error=>error);
    expect(error.code).toBe('LLM_HTTP');expect(error.message).toContain(p.baseUrl+'/messages');expect(error.message).toContain('HTTP '+status);
    if(status===401)expect(error.message).toContain('鉴权失败');
    if(status===403)expect(error.message).toContain('访问被拒绝');
    expect(error.message).not.toContain('private-upstream-key');expect(await service.list()).toEqual(saved);
  }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}
});
