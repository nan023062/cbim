/**
 * 作用定位：本机知识存储，承担初始化、快照、预览、串行事务、索引写入和崩溃恢复。
 * 设计原因：从工作区生命周期抽离物理事务；继续使用原日志格式和版本检查，不改变并发或回滚语义。
 */
import fs from 'node:fs/promises';
import {readKnowledge} from './files';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {atomic,exists,readJson} from '../../../core/foundation/files';
import {hash,json} from '../../../core/foundation/serialization';
import {fail} from '../../../core/foundation/errors';
import type {StoragePaths} from '../../../core/foundation/paths';
import {Rules,revision,INDEXES,isKnowledge,parseJson} from '../../../core/knowledge/knowledge';
import type {Snapshot,ChangeRequest,Preview,Change} from '../../../core/knowledge/types';

/** 存储通过此端口报告实例状态；不持有 MCP、Electron 或工作区执行管理器。 */
export interface KnowledgeStoreOwner {
 readonly entry:{id:string;path:string}; readonly instanceId:string; readonly paths:StoragePaths; readonly rules:Rules;
 state:string; error?:string; knowledgeErrors:number; lastRevision:string; changed:boolean;
 readonly fault?: (step:number)=>void;
 assert(identity?:{workspaceId:string;instanceId:string}):void;
}
interface CommitResult {state:string;workspaceId:string;instanceId:string;requestId:string;revision:string;changed:string[]}
interface Journal {version:1;workspaceId:string;requestId:string;fingerprint:string;state:'prepared'|'committing'|'committed'|'rolled_back'|'recovery_required';before:Record<string,string|null>;after:Record<string,string|null>;result?:CommitResult}
/** 工作区持有一个存储实例，关闭前等待 drain，观察器避开正在提交的事务。 */
export class KnowledgeStore {
 private queue:Promise<unknown>=Promise.resolve();
 activeOperations=0;
 constructor(private owner:KnowledgeStoreOwner,private log:(event:string,details?:Record<string,unknown>)=>Promise<void>){}
 /** 等待已经进入队列的事务结束；不会取消半完成提交。 */
 async drain(){await this.queue}
  async initialize(){
    const dir=path.join(this.owner.entry.path,'.cbim');
    if(await exists(dir)){await this.owner.paths.knowledge(this.owner.entry.path,'.cbim/project.json');const manifest=path.join(dir,'project.json');
      if(await exists(manifest)){const d=await readJson(manifest);if(d.formatVersion!==1||d.rulesVersion!==1)fail('INCOMPATIBLE','知识版本不兼容；请备份并 review 迁移方案，程序不会自动重写')}
      for(const required of ['workspace','team','connectors'])if(!await exists(path.join(dir,required)))fail('INCOMPATIBLE',`已有 .cbim 缺少 ${required}；请先补全或迁移，不覆盖现有内容`);return;
    }
    // Build a complete template alongside the target, then rename on the same volume.
    const staging=path.join(this.owner.entry.path,`.cbim-init-${this.owner.instanceId}`);await fs.mkdir(staging);
    try{for(const folder of ['workspace','team','team/skills','connectors'])await fs.mkdir(path.join(staging,folder));
      const initial:Record<string,unknown>={'project.json':{formatVersion:1,rulesVersion:1},'team/registry.json':{groups:[]},'team/people.json':{people:[]},'team/skills.json':{skills:[]},'workspace/registry.json':{modules:[]},'connectors/registry.json':{connectors:[]}};
      for(const [p,value]of Object.entries(initial))await atomic(path.join(staging,p),json(value));
      await atomic(path.join(staging,'README.md'),`# CBIM 生产与治理体系

此目录保存当前项目经 review 的正式团队能力与业务知识。

宿主启动流程直接嵌入项目根 AGENTS.md、CLAUDE.md；通过 cbim_ MCP 工具查询知识、获取 Skill 和执行治理，不读取本目录中的入口文件。

## 团队能力树

team/ 是根 Team，中间非叶子节点是小组，叶子节点是 Agent。
Team、小组和 Agent 各自维护 Skill：Team 与小组通过 skills.json 登记，Agent 通过 agent.json.skills 登记，正文位于所属节点 skills/<slug>/SKILL.md。
Agent 可用 Skill 为自身 Skill 与沿父链递归到根 Team 的全部祖先 Skill；不继承兄弟节点的 Skill。
空团队的根仍是 Team，不因尚无成员而变成 Agent。

## 业务模块树

workspace/ 是业务根容器，一级 Module 是按领域划分的工程节点，以下是各工程的模块节点。
每个 Module 通过 module.json.workflows 登记自己的 Workflow，正文位于本模块 workflows/<slug>/workflow.md。
Agent 任务基于明确的 Module，仅使用该模块自身 Workflow，不继承父模块、工程节点或其他模块的流程。
workspace 根不创建共享 Workflow 清单或流程目录。

## 初始内容

项目版本保存在 project.json；team/registry.json、team/people.json、team/skills.json、workspace/registry.json 和 connectors/registry.json 初始均为空清单。
team/skills/ 预留根 Team 的 Skill 正文。领域工程、小组、Agent、模块及流程由团队后续定义，不自动创建示例或导入资源仓库内容。
skills/、workflows/ 及其资料目录不属于组织或模块节点。

运行日志、事务记录、MCP 发现信息和凭据保存在用户目录，不写入此项目知识目录。
`);
      if(await exists(dir))fail('CONFLICT','初始化期间出现 .cbim，请检查后重新打开');await fs.rename(staging,dir);
    }finally{await fs.rm(staging,{recursive:true,force:true})}
  }
  async read():Promise<Snapshot>{const files=await readKnowledge(this.owner.paths,this.owner.entry.path);return {workspaceId:this.owner.entry.id,instanceId:this.owner.instanceId,revision:revision(files),files}}
  /** 读取当前正文并校验；返回结构错误不等于 MCP 服务不可用。 */
  async snapshot(){this.owner.assert();const snapshot=await this.read();snapshot.validation=await this.owner.rules.validate(this.owner.entry.path,snapshot.files);this.owner.knowledgeErrors=snapshot.validation.issues.filter(i=>i.severity==='error').length;
    for(const [p,text]of Object.entries(snapshot.validation.indexes)){const old=snapshot.files.find(f=>f.path===p);if(old?.text!==text)snapshot.validation.issues.push({severity:'warning',code:'index_stale',path:p,message:'派生注册表与知识定义不一致，可通过校验并更新索引修复'})}
    if(await exists(path.join(this.owner.entry.path,'.cbim.local')))snapshot.validation.issues.push({severity:'warning',code:'legacy_local',path:'.cbim.local',message:'发现旧本地历史目录。请先备份并核对身份；未授权不会移动或删除。'});return snapshot}
  private serial<T>(operation:()=>Promise<T>):Promise<T>{const current=this.queue.then(operation);this.queue=current.catch(()=>{});return current}
  private async draft(request:ChangeRequest):Promise<Preview>{
    this.owner.assert(request);if(!/^[A-Za-z0-9_-]{8,100}$/.test(request.requestId))fail('REQUEST_ID','请求标识须为 8–100 位字母、数字、下划线或横线');
    const snapshot=await this.read();if(snapshot.revision!==request.revision)fail('CONFLICT','知识已被外部修改，请重新读取并合并');
    const map=new Map(snapshot.files.map(f=>[f.path,f.text]));const seen=new Set<string>();
    for(const change of request.changes){await this.owner.paths.knowledge(this.owner.entry.path,change.path);if(!isKnowledge(change.path)||INDEXES.includes(change.path)||change.path==='.cbim/project.json')fail('TYPE','该路径不是可编辑的正式知识类型，索引与版本由程序维护');if(seen.has(change.path.toLowerCase()))fail('DUPLICATE','一个事务不能重复修改同一文件');seen.add(change.path.toLowerCase());if(change.text!==null&&Buffer.byteLength(change.text)>2*1024*1024)fail('SIZE','单文件不能超过 2 MiB');change.text===null?map.delete(change.path):map.set(change.path,change.text)}
    const projected=[...map].map(([p,text])=>({path:p,text,hash:hash(text)}));const validation=await this.owner.rules.validate(this.owner.entry.path,projected);
    const changes=[...request.changes];if(validation.structural)for(const [p,text]of Object.entries(validation.indexes))if(map.get(p)!==text)changes.push({path:p,text});
    const affected=snapshot.files.filter(f=>request.changes.some(c=>f.text.includes(c.path)||f.text.includes(path.posix.basename(c.path)))).map(f=>f.path);
    const diff=changes.map(c=>`--- ${c.path}\n${snapshot.files.find(f=>f.path===c.path)?.text||'(新建)'}\n+++ ${c.path}\n${c.text??'(删除)'}`).join('\n\n');
    return {request,changes,validation,affected,diff,fingerprint:hash(json(request))};
  }
  /** 只生成差异和校验结果，不写正式知识；提交必须再次核对读取版本。 */
  async preview(request:ChangeRequest){return this.serial(()=>this.draft(request))}
  /** 按串行队列执行版本检查和带日志的写入；同请求内容幂等，失败时只回滚仍匹配本次写入的文件。 */
  async commit(request:ChangeRequest){this.owner.assert(request);return this.serial(async()=>{
    this.owner.assert(request);this.activeOperations++;
    try{
      const journalPath=path.join(this.owner.paths.local(this.owner.entry.id,'transactions'),request.requestId+'.json');
      if(await exists(journalPath)){const old=await readJson<Journal>(journalPath);if(old.fingerprint!==hash(json(request)))fail('IDEMPOTENCY','请求标识已用于不同变更');if(old.state==='committed'&&old.result)return old.result;fail('RECOVERY','此前请求未提交或已回滚，请重新读取后使用新请求标识')}
      const preview=await this.draft(request);if(!preview.validation.structural)fail('VALIDATION',preview.validation.issues.filter(x=>x.severity==='error').map(x=>`${x.path}: ${x.message}`).join('\n'));
      const current=await this.read();if(current.revision!==request.revision)fail('CONFLICT','校验期间知识已变化');
      const before:Record<string,string|null>={},after:Record<string,string|null>={};for(const c of preview.changes){before[c.path]=current.files.find(f=>f.path===c.path)?.text??null;after[c.path]=c.text}
      const journal:Journal={version:1,workspaceId:this.owner.entry.id,requestId:request.requestId,fingerprint:preview.fingerprint,state:'prepared',before,after};await atomic(journalPath,json(journal));
      const expected=new Map(current.files.map(f=>[f.path,f]));journal.state='committing';await atomic(journalPath,json(journal));
      try{let n=0;for(const [p,text]of Object.entries(after)){
          const live=await this.read();if(live.revision!==revision([...expected.values()]))fail('CONFLICT','提交期间检测到外部修改，正在安全回滚');
          await this.write(p,text);if(text===null)expected.delete(p);else expected.set(p,{path:p,text,hash:hash(text)});this.owner.fault?.(++n);
        }
        const final=await this.read();if(final.revision!==revision([...expected.values()]))fail('CONFLICT','提交末尾出现外部修改');
        const result={state:'committed',workspaceId:this.owner.entry.id,instanceId:this.owner.instanceId,requestId:request.requestId,revision:final.revision,changed:Object.keys(after)};
        journal.state='committed';journal.result=result;await atomic(journalPath,json(journal));this.owner.lastRevision=final.revision;this.owner.changed=false;await this.log('committed',{requestId:request.requestId,files:Object.keys(after).length});return result;
      }catch(e){await this.rollback(journal,journalPath);throw e}
    }finally{this.activeOperations--}
  })}
  private async write(relative:string,text:string|null){const target=await this.owner.paths.knowledge(this.owner.entry.path,relative);if(text===null)await fs.rm(target,{force:true});else await atomic(target,text)}
  private async rollback(journal:Journal,p:string){let blocked=false;
    for(const name of Object.keys(journal.after).reverse()){const target=await this.owner.paths.knowledge(this.owner.entry.path,name);const live=await exists(target)?await fs.readFile(target,'utf8'):null;if(live===journal.before[name])continue;if(live!==journal.after[name]){blocked=true;continue}try{await this.write(name,journal.before[name])}catch{blocked=true}}
    journal.state=blocked?'recovery_required':'rolled_back';await atomic(p,json(journal));if(blocked){this.owner.state='recovery_required';this.owner.error='恢复遇到外部修改，保留现场与事务证据，请人工合并后重新打开'}
  }
  /** 重放未完成事务的恢复步骤；发现外部修改则保留现场并进入需要恢复状态。 */
  async recover(){const dir=this.owner.paths.local(this.owner.entry.id,'transactions');await fs.mkdir(dir,{recursive:true});for(const file of await fs.readdir(dir)){if(!file.endsWith('.json'))continue;const p=path.join(dir,file);const journal=await readJson<Journal>(p);if(journal.workspaceId!==this.owner.entry.id)fail('IDENTITY','事务记录属于其他工程');if(['prepared','committing','recovery_required'].includes(journal.state)){await this.rollback(journal,p);if(journal.state==='recovery_required')fail('RECOVERY','未完成事务与外部修改冲突；请根据本地事务证据人工合并后重新打开')}}}
  async planMove(snapshot:Snapshot,from:string,to:string|null):Promise<ChangeRequest>{
    this.owner.assert(snapshot);await this.owner.paths.knowledge(this.owner.entry.path,from);if(to)await this.owner.paths.knowledge(this.owner.entry.path,to);
    const prefix=(p:string)=>p===from||p.startsWith(from+'/');const moved=snapshot.files.filter(f=>prefix(f.path));if(!moved.length)fail('NOT_FOUND','移动或删除对象不存在');
    const changes:Change[]=[];const mapPath=(p:string)=>to&&prefix(p)?to+p.slice(from.length):p;
    for(const f of snapshot.files){const newPath=mapPath(f.path);if(to&&newPath!==f.path&&snapshot.files.some(x=>x.path===newPath))fail('CONFLICT','目标已存在');let text=f.text;
      if(f.path.endsWith('.json')&&!INDEXES.includes(f.path)){
        const owner=path.posix.dirname(f.path),newOwner=path.posix.dirname(newPath);
        const rewrite=(value:any,key=''):any=>{if(typeof value==='string'){
          if(['id','children'].includes(key)&&prefix(value)){if(!to)fail('REFERENCE',`仍被 ${f.path} 引用，请在事务中显式修正引用`);return mapPath(value)}
          if(['overview','reference','work_principles'].includes(key)){const resolved=path.posix.normalize(path.posix.join(owner,value));if(prefix(resolved)&&!to&&!prefix(f.path))fail('REFERENCE',`仍被 ${f.path} 引用`);return path.posix.relative(newOwner,mapPath(resolved))}
          return value}
          if(Array.isArray(value))return value.map(v=>rewrite(v,key));if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,rewrite(v,k)]));return value};
        if(!prefix(f.path)||to){const d=rewrite(parseJson(text));if(f.path.endsWith('/module.json')&&newPath!==f.path)d.name=path.posix.basename(path.posix.dirname(newPath));text=json(d)}
      }else if(f.path.endsWith('.md')){
        text=text.replace(/\]\(([^)]+)\)/g,(match,link:string)=>{if(/^[a-z]+:/i.test(link)||link.startsWith('#'))return match;const [location,anchor]=link.split('#');const resolved=path.posix.normalize(path.posix.join(path.posix.dirname(f.path),location));if(prefix(resolved)&&!to&&!prefix(f.path))fail('REFERENCE',`仍被 ${f.path} 的 Markdown 链接引用`);const updated=path.posix.relative(path.posix.dirname(newPath),mapPath(resolved));return `](${updated}${anchor?'#'+anchor:''})`});
      }
      if(INDEXES.includes(f.path))continue;if(prefix(f.path)){changes.push({path:f.path,text:null});if(to)changes.push({path:newPath,text})}else if(text!==f.text)changes.push({path:f.path,text});
    }
    return {workspaceId:this.owner.entry.id,instanceId:this.owner.instanceId,revision:snapshot.revision,requestId:randomUUID(),changes};
  }
}
