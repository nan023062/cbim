/**
 * 作用定位：在具体引擎之外固定原生会话使用的受管 E 包身份，保存在原 agentHome 的私有旁路记录。
 * 设计原因：资源更新可更换下载包，但不能让新引擎静默改写旧原生历史；不修改 SDK 历史文件或业务审计格式。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import type {AgentEngine} from '../core/execution/types';
import type {EngineRuntimePackage} from '../core/execution/engine-runtime';

const binding=z.object({schema:z.literal(1),kind:z.string(),sessionId:z.string(),identity:z.string().regex(/^[a-f0-9]{64}$/),version:z.string(),toolsIdentity:z.string().optional()}).strict();
// 只用于旧整包版本迁移。以后提高适配器版本时不能跟着改此表，否则会默许跨版本恢复。
const legacyVersions:Record<string,string>={pi:'1.5.0','claude-code':'0.3.322',codex:'0.167.0'};
/** 仅受管运行包启用身份固定；开发与旧测试宿主保留原生命周期，更新不自动续跑历史任务。 */
export function pinRuntimeEngine(engine:AgentEngine,home:string,runtime?:EngineRuntimePackage,tools?:EngineRuntimePackage):AgentEngine{
  if(!runtime)return engine;
  const directory=path.join(home,'runtime-bindings');
  const file=(id:string)=>path.join(directory,createHash('sha256').update(engine.kind+'\n'+id).digest('hex')+'.json');
  const expected=(sessionId:string)=>({schema:1 as const,kind:engine.kind,sessionId,identity:runtime.identity,version:runtime.version,...(tools?{toolsIdentity:tools.identity}:{})});
  async function check(id:string,legacyResume=false){
    let text:string;try{const stat=await fs.lstat(file(id));if(!stat.isFile()||stat.isSymbolicLink()||stat.size>16384)throw Error('引擎会话版本记录无效');text=await fs.readFile(file(id),'utf8')}catch(error:any){
      if(error.code!=='ENOENT')throw error;
      if(legacyResume&&(runtime!.version!==legacyVersions[engine.kind]||tools&&tools.version!==legacyVersions.pi))throw Error('旧会话没有此引擎版本的兼容记录，请保留历史并新建对话');return;
    }
    const saved=binding.parse(JSON.parse(text)),current=expected(id);
    if(saved.kind!==current.kind||saved.sessionId!==id||saved.identity!==current.identity||saved.version!==current.version||saved.toolsIdentity!==current.toolsIdentity)throw Error('此会话绑定的引擎包已变化，请保留历史并新建对话；未用新引擎恢复旧原生会话');
  }
  async function remember(id:string){
    await fs.mkdir(directory,{recursive:true});
    try{const handle=await fs.open(file(id),'wx',0o600);try{await handle.writeFile(JSON.stringify(expected(id)));await handle.sync()}finally{await handle.close()}}
    catch(error:any){if(error.code!=='EEXIST')throw error;await check(id)}
  }
  return {kind:engine.kind,
    async start(context){
      if(context.sessionFile&&!context.nativeSessionId)throw Error('原生恢复缺少会话身份');
      if(context.nativeSessionId)await check(context.nativeSessionId,!!context.sessionFile);
      await engine.start({...context,emit:async event=>{if(event.type==='session.bound'&&typeof event.data.sessionId==='string')await remember(event.data.sessionId);await context.emit(event)}});
    },
    run:message=>engine.run(message),stop:()=>engine.stop(),close:()=>engine.close(),
    ...(engine.steer?{steer:(...args:Parameters<NonNullable<AgentEngine['steer']>>)=>engine.steer!(...args)}:{}),
  };
}
