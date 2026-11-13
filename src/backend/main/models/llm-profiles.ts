/**
 * 目录归属：backend/main/models；模型配置持久化。
 * 作用定位：本机供应商配置持久化、默认模型选择和连接检测。
 * 设计原因：运行与岗位登记共用实际模型选型；岗位领取在同一配置队列中固定公开参数并延迟解密，与设置修改形成明确先后，凭据不进入登记或任务日志。
 * 运行引擎由调用方独立传入；连接错误保留安全端点与状态诊断，不泄露密钥、查询参数或供应商响应正文，不清空已保存模型目录。
 * 运行、岗位和显式测试在解密前共用接口选择；候选地址不进入运行快照，列表读取不会探测网络。
 */
import fs from 'node:fs/promises';
import {SerialQueue} from '../../../foundations/concurrency';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {engineLabel,loopEngineSchema,type LoopEngine} from '../../core/models/engine';
import {connectionForEngine} from '../../core/models/provider-connections';
import {parseModelCatalog} from '../../core/models/catalog';
import {atomic} from '../../../foundations/files';
import {fail} from '../../core/foundation/errors';
import {connectionSchema,definition,type LlmDefinition,type LlmSettings} from '../../core/models/config';
export type {LlmDefinition,LlmProfile,LlmSettings} from '../../core/models/config';
import type {SecretCipher,ResolvedLlm} from '../../core/models/ports';
export type {SecretCipher,ResolvedLlm} from '../../core/models/ports';
interface DiskProfile extends LlmDefinition {id:string;encryptedKey?:string}
interface ModelFile {version:1;selectedId?:string;profiles:DiskProfile[]}
/** 明确岗位选型，不允许默认模型或主会话设置参与解析。 */
export interface ExplicitModelReference {profileId:string;modelId:string;engine?:LoopEngine}
/** 只在持锁回调存活期间解析捕获定义；调用方必须先通过预算与占用，返回后不得重新解析。 */
export interface LockedModelConfiguration {profile:ResolvedLlm['profile'];resolve():ResolvedLlm}
const fileSchema=z.object({version:z.literal(1),selectedId:z.string().uuid().optional(),profiles:z.array(z.object({id:z.string().uuid(),encryptedKey:z.string().optional()}).passthrough()).max(100)});
/** 单一纯选型投影；只有运行 resolve 可在选定之后解密，登记调用必须显式给出两个 ID。 */
function selectConfiguration(data:ModelFile,id?:string,modelId?:string,engine?:LoopEngine){
  const definition=data.profiles.find(profile=>profile.id===(id??data.selectedId));if(!definition)fail('LLM_REQUIRED','请先在设置中配置默认大模型');
  const model=definition.models.find(item=>item.id===(modelId??definition.defaultModel)&&item.enabled);if(!model)fail('LLM_MODEL','模型不存在或已禁用');
  if(engine!==undefined)loopEngineSchema.parse(engine);
  const connection=connectionForEngine(definition,engine??'pi',model.id);
  if(!connection)fail('LLM_ENGINE_API',engineLabel(engine??'pi')+' 没有可用的兼容接口，请在模型设置中配置该供应商的兼容接口');
  const profile:ResolvedLlm['profile']={id:definition.id,name:definition.name,api:connection.api,baseUrl:connection.baseUrl,auth:definition.auth,model:model.id,contextWindow:model.contextWindow,maxTokens:model.maxTokens,reasoning:model.reasoning,
    ...(model.vision===undefined?{}:{vision:model.vision}),...(model.outputLimit===undefined?{}:{outputLimit:model.outputLimit}),...(model.thinkingLevel===undefined?{}:{thinkingLevel:model.thinkingLevel}),...(model.workingContextWindow===undefined?{}:{workingContextWindow:model.workingContextWindow}),...(model.compactionPercent===undefined?{}:{compactionPercent:model.compactionPercent}),...(model.pricing===undefined?{}:{pricing:structuredClone(model.pricing)})};
  // 单次运行只冻结实际接口；不改写供应商主接口或历史快照。
  if(engine!==undefined)profile.engine=engine;
  return {definition,profile};
}
export class LlmProfiles {
  /** 保存与受控选型回调共用本实例队列；失败只拒绝本次调用，不自动重试。 */
  private readonly queue=new SerialQueue();
  constructor(private filename:string,private cipher?:SecretCipher){}
  private async read():Promise<ModelFile>{
    let raw:any;try{raw=JSON.parse(await fs.readFile(this.filename,'utf8'))}catch(e:any){if(e.code==='ENOENT')return {version:1,profiles:[]};throw Error('模型配置读取失败，请检查配置文件')}
    const data=fileSchema.parse(raw),profiles=data.profiles.map(p=>{const {id,encryptedKey,...rest}=p;return {...definition.parse(rest),id,encryptedKey}});
    if(new Set(profiles.map(p=>p.id)).size!==profiles.length||data.selectedId&&!profiles.some(p=>p.id===data.selectedId))fail('LLM_CONFIG','模型配置身份不一致');
    return {version:1,selectedId:data.selectedId,profiles};
  }
  private view(data:ModelFile):LlmSettings{return {selectedId:data.selectedId,secureStorage:this.cipher?.available()===true,profiles:data.profiles.map(({encryptedKey,...p})=>({...p,hasKey:!!encryptedKey}))}}
  async list(){return this.view(await this.read())}
  private change<T>(operation:()=>Promise<T>){return this.queue.run(operation)}
  /** 空密钥保留原值；主接口变更或新增自定义凭据目标必须重新输入，纯改名、模型范围调整和移除兼容接口不需要。 */
  save(input:unknown){return this.change(async()=>{
    const r=z.object({id:z.string().uuid().optional(),profile:definition,apiKey:z.string().max(16000).optional()}).strict().parse(input);
    const data=await this.read(),previous=data.profiles.find(p=>p.id===r.id);if(r.id&&!previous)fail('LLM_NOT_FOUND','供应商不存在');
    let encryptedKey:string|undefined;
    if(r.profile.auth==='api-key'){
      if(r.apiKey){if(!this.cipher?.available())fail('SECRET_STORAGE','系统加密不可用，无法保存 API Key');encryptedKey=this.cipher.encrypt(r.apiKey)}
      else {
        const addedTarget=r.profile.alternateConnections?.some(connection=>!previous?.alternateConnections?.some(old=>old.api===connection.api&&old.baseUrl===connection.baseUrl));
        if(previous&&(previous.baseUrl!==r.profile.baseUrl||previous.api!==r.profile.api||addedTarget))fail('KEY_REQUIRED','更换接口地址、协议或新增兼容接口后请重新输入 API Key');
        encryptedKey=previous?.encryptedKey;
      }
      if(!encryptedKey)fail('KEY_REQUIRED','请输入 API Key');
    }
    const profile={...r.profile,id:previous?.id??randomUUID(),encryptedKey};
    if(previous)data.profiles=data.profiles.map(p=>p.id===profile.id?profile:p);else {if(data.profiles.length>=100)fail('LIMIT','最多保存 100 个供应商');data.profiles.push(profile)}
    data.selectedId??=profile.id;await atomic(this.filename,JSON.stringify(data,null,2));return this.view(data);
  })}
  select(id:string){return this.change(async()=>{const data=await this.read();if(!data.profiles.some(p=>p.id===id))fail('LLM_NOT_FOUND','供应商不存在');data.selectedId=id;await atomic(this.filename,JSON.stringify(data,null,2));return this.view(data)})}
  remove(id:string){return this.change(async()=>{const data=await this.read();if(!data.profiles.some(p=>p.id===id))fail('LLM_NOT_FOUND','供应商不存在');data.profiles=data.profiles.filter(p=>p.id!==id);if(data.selectedId===id)data.selectedId=data.profiles[0]?.id;await atomic(this.filename,JSON.stringify(data,null,2));return this.view(data)})}
  private decrypt(p:DiskProfile){
    if(p.auth==='none')return 'cbim-local-no-auth';
    if(!p.encryptedKey||!this.cipher?.available())fail('SECRET_STORAGE','模型密钥不可用，请重新保存 API Key');
    try{return this.cipher.decrypt(p.encryptedKey)}catch{fail('SECRET_STORAGE','模型密钥无法解密，请重新保存 API Key')}
  }
  /** 将公开供应商配置展开为选定模型；禁用模型不得用于新运行。 */
  async resolve(id?:string,modelId?:string,engine?:LoopEngine):Promise<ResolvedLlm>{
    const selected=selectConfiguration(await this.read(),id,modelId,engine);return {profile:selected.profile,apiKey:this.decrypt(selected.definition)};
  }
  /** 供岗位登记与当前差异读取；不使用默认选择、不解密、不探测接口，也不保证凭据可用或模型能运行。 */
  async configuration(profileId:string,modelId:string,engine?:LoopEngine):Promise<ResolvedLlm['profile']>{
    if(!z.string().uuid().safeParse(profileId).success||typeof modelId!=='string'||!modelId.trim())fail('LLM_REQUIRED','岗位配置必须明确选择供应商与模型');
    return selectConfiguration(await this.read(),profileId,modelId,engine).profile;
  }
  /** 多岗位一次读取并持有设置队列，直到短事务结束；公开快照无凭据，不联网，不在回调中再次进入本队列。 */
  withConfigurations<T>(refs:readonly ExplicitModelReference[],use:(profiles:readonly ResolvedLlm['profile'][])=>Promise<T>):Promise<T>{
    const fixed=structuredClone(refs);return this.change(async()=>{
      const data=await this.read();
      const profiles=fixed.map(ref=>{this.explicit(ref);return selectConfiguration(data,ref.profileId,ref.modelId,ref.engine).profile});
      return use(profiles);
    });
  }
  /**
   * 固定配置至领取事务提交；resolve 只解密已捕获定义，不读取设置或重新排队。
   * 预算/占用通过后才能调用 resolve；真正启动引擎在回调及所有锁释放后，之后设置修改不热替换本段。
   */
  withRuntimeConfiguration<T>(ref:ExplicitModelReference,use:(configuration:LockedModelConfiguration)=>Promise<T>):Promise<T>{
    const fixed=structuredClone(ref);return this.change(async()=>{
      this.explicit(fixed);const selected=selectConfiguration(await this.read(),fixed.profileId,fixed.modelId,fixed.engine);
      let active=true,resolved:ResolvedLlm|undefined;
      try{return await use({profile:structuredClone(selected.profile),resolve:()=>{
        if(!active)fail('LLM_CONFIGURATION_EXPIRED','模型配置准备已结束，不能重新解析凭据');
        return resolved??={profile:structuredClone(selected.profile),apiKey:this.decrypt(selected.definition)};
      }})}finally{active=false}
    });
  }
  private explicit(ref:ExplicitModelReference){if(!z.string().uuid().safeParse(ref.profileId).success||typeof ref.modelId!=='string'||!ref.modelId.trim())fail('LLM_REQUIRED','岗位配置必须明确选择供应商与模型')}
  /** 获取草稿接口的模型 ID；失败不阻止手动添加。保存凭据只在同地址、同协议时复用。 */
  async discover(input:unknown){return (await this.discoverDetails(input)).map(m=>m.id)}
  /** 读取供应商能力元数据；缺失字段不以固定 32k/200k 替代，不自动写回配置。 */
  async discoverDetails(input:unknown){
    const r=z.object({id:z.string().uuid().optional(),connection:connectionSchema.strict(),apiKey:z.string().max(16000).optional()}).strict().parse(input);
    let key=r.apiKey||'';
    if(r.connection.auth==='api-key'&&!key){const p=(await this.read()).profiles.find(p=>p.id===r.id);if(!p||p.baseUrl!==r.connection.baseUrl||p.api!==r.connection.api)fail('KEY_REQUIRED','请先输入该接口的 API Key');key=this.decrypt(p)}
    const base=r.connection.baseUrl.replace(/\/$/,''),anthropic=r.connection.api==='anthropic-messages';
    const url=base+(anthropic&&!base.endsWith('/v1')?'/v1/models':'/models');
    const body=await this.request(url,{headers:this.headers(r.connection.api,r.connection.auth,key)});
    if(!Array.isArray(body.data))fail('LLM_RESPONSE','接口未返回模型列表，请手动添加模型');
    return parseModelCatalog(body.data);
  }
  private headers(api:string,auth:string,key:string){const h:Record<string,string>={'Content-Type':'application/json'};if(api==='anthropic-messages'){h['anthropic-version']='2023-06-01';if(auth==='api-key')h['x-api-key']=key}else if(auth==='api-key')h.Authorization='Bearer '+key;return h}
  /** 显式探测的诊断只保留 origin/path；不返回查询参数、服务器正文、请求头或密钥。 */
  private async request(url:string,init:RequestInit){
    const endpoint=new URL(url);endpoint.username='';endpoint.password='';endpoint.search='';endpoint.hash='';
    try{
      const response=await fetch(url,{...init,redirect:'error',signal:AbortSignal.timeout(15000)});
      if(!response.ok){
        await response.body?.cancel();
        const reason=response.status===401?'鉴权失败，请重新保存该供应商的 API Key':response.status===403?'访问被拒绝，请检查密钥权限与供应商访问限制':response.status===404?'端点或模型不存在，请核对接口协议、地址和模型 ID':response.status===429?'请求受限，请检查额度或稍后重试':'请检查供应商服务与接口配置';
        fail('LLM_HTTP',`模型端点 ${endpoint.href} 返回 HTTP ${response.status}：${reason}`);
      }
      const reader=response.body?.getReader();let text='';if(reader){const decoder=new TextDecoder();while(true){const part=await reader.read();if(part.done)break;text+=decoder.decode(part.value,{stream:true});if(text.length>1024*1024){await reader.cancel();fail('LLM_RESPONSE','模型响应过大')}}text+=decoder.decode()}
      return JSON.parse(text);
    }catch(e:any){if(['LLM_HTTP','LLM_RESPONSE'].includes(e.code))throw e;fail('LLM_CONNECTION',`模型端点 ${endpoint.href} 连接失败或超时，请检查网络与接口配置`)}
  }
  /** 按明确引擎测试已保存模型的实际接口；不写兼容状态或改目录，短文本成功不代表工具/流式完整验收。 */
  async test(id:string,modelId?:string,engine?:LoopEngine){
    const {profile:p,apiKey}=await this.resolve(id,modelId,engine),started=Date.now(),anthropic=p.api==='anthropic-messages',responses=p.api==='openai-responses';
    const base=p.baseUrl.replace(/\/$/,''),url=base+(anthropic?(base.endsWith('/v1')?'/messages':'/v1/messages'):responses?'/responses':'/chat/completions');
    const payload=responses?{model:p.model,max_output_tokens:64,stream:false,input:'Reply with OK.'}:{model:p.model,max_tokens:64,stream:false,messages:[{role:'user',content:'Reply with OK.'}]};
    const body=await this.request(url,{method:'POST',headers:this.headers(p.api,p.auth,apiKey),body:JSON.stringify(payload)});
    const valid=anthropic?body.content?.some((x:any)=>x.type==='text'&&typeof x.text==='string'):responses?body.output?.some((x:any)=>x.type==='message'&&x.content?.some((c:any)=>c.type==='output_text'&&typeof c.text==='string')):typeof body.choices?.[0]?.message?.content==='string';
    if(!valid)fail('LLM_RESPONSE','接口没有返回有效文本，请核对接口协议');
    return {ok:true,model:p.model,latencyMs:Date.now()-started,engine:engine??'pi',api:p.api,baseUrl:p.baseUrl};
  }
}
