import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID,randomBytes} from 'node:crypto';
import {Paths,atomic,exists,hash,json,readJson,fail} from './paths';
import {KernelLock} from './locking';
import {Rules,readKnowledge,revision,INDEXES,isKnowledge,parseJson} from './knowledge';
import type {WorkspaceEntry,WorkspaceView,Snapshot,ChangeRequest,Preview,KnowledgeFile,Change,TaskView} from '../shared/types';
interface CommitResult {state:string;workspaceId:string;instanceId:string;requestId:string;revision:string;changed:string[]}
interface Journal {version:1;workspaceId:string;requestId:string;fingerprint:string;state:'prepared'|'committing'|'committed'|'rolled_back'|'recovery_required';before:Record<string,string|null>;after:Record<string,string|null>;result?:CommitResult}
export class Workspace {
  readonly instanceId=randomUUID();readonly readToken=randomBytes(32).toString('hex');readonly writeToken=randomBytes(32).toString('hex');
  state='registered';error?:string;writable=false;changed=false;lastRevision='';
  readonly tasks=new Map<string,TaskView>();private controllers=new Map<string,AbortController>();
  private lock?:KernelLock;private queue:Promise<unknown>=Promise.resolve();private watcher?:NodeJS.Timeout;private polling=false;
  private closeTransport?:()=>Promise<void>;private activeOperations=0;
  // Fault injection is an explicit dependency used only by isolated tests.
  constructor(readonly entry:WorkspaceEntry,readonly paths:Paths,readonly rules:Rules,readonly fault?:(step:number)=>void){}
  view():WorkspaceView{return {...this.entry,state:this.state,error:this.error,writable:this.writable,tasks:[...this.tasks.values()],revision:this.lastRevision,changed:this.changed}}
  assert(identity?:{workspaceId:string;instanceId:string}){if(this.state!=='running')fail('NOT_RUNNING',`工作区当前状态：${this.state}`);if(identity&&(identity.workspaceId!==this.entry.id||identity.instanceId!==this.instanceId))fail('STALE_INSTANCE','工程或运行实例身份不匹配，请重新发现并连接')}
  async open(start:(workspace:Workspace)=>Promise<{url:string;close:()=>Promise<void>;probe:()=>Promise<void>}>){
    if(this.state==='running')return;this.state='opening';
    try{
      const identity=await this.paths.identity(this.entry.path);if(identity.id!==this.entry.id)fail('IDENTITY','工程真实路径已变化，需要重新定位');
      this.lock=new KernelLock(identity.path,identity.id);
      const mapping=path.join(this.paths.project(identity.id),'identity.json');if(await exists(mapping)&&(await readJson(mapping)).path!==identity.path)fail('IDENTITY','本地历史记录绑定的工程不匹配');await atomic(mapping,json(identity));
      await this.recover();await this.initialize();
      const snapshot=await this.read();this.lastRevision=snapshot.revision;
      const validation=await this.rules.validate(this.entry.path,snapshot.files);if(!validation.structural)this.error='知识包含错误，可打开修复；详见问题列表';
      this.state='running';const transport=await start(this);this.closeTransport=transport.close;await transport.probe();
      await atomic(path.join(this.paths.project(this.entry.id),'credentials.json'),json({workspaceId:this.entry.id,instanceId:this.instanceId,readToken:this.readToken,writeToken:this.writeToken}));
      await atomic(this.paths.discovery(this.entry.id),json({version:1,protocol:'mcp-streamable-http',workspaceId:this.entry.id,root:this.entry.path,instanceId:this.instanceId,pid:process.pid,url:transport.url,createdAt:new Date().toISOString(),credentialFile:'credentials.json'}));
      await this.log('opened');
      this.watcher=setInterval(()=>{if(this.polling||this.state!=='running'||this.activeOperations)return;this.polling=true;void this.read().then(s=>{if(s.revision!==this.lastRevision){this.changed=true;this.lastRevision=s.revision}}).catch(e=>{this.error=e.message}).finally(()=>{this.polling=false})},1200);this.watcher.unref();
    }catch(e:any){this.error=e.message;this.state='failed';await this.closeTransport?.();await this.clearDiscovery();this.lock?.close();this.lock=undefined;throw e}
  }
  private async initialize(){
    const dir=path.join(this.entry.path,'.cbim');
    if(await exists(dir)){await this.paths.knowledge(this.entry.path,'.cbim/project.json');const manifest=path.join(dir,'project.json');
      if(await exists(manifest)){const d=await readJson(manifest);if(d.formatVersion!==1||d.rulesVersion!==1)fail('INCOMPATIBLE','知识版本不兼容；请备份并 review 迁移方案，程序不会自动重写')}
      for(const required of ['workspace','team','connectors'])if(!await exists(path.join(dir,required)))fail('INCOMPATIBLE',`已有 .cbim 缺少 ${required}；请先补全或迁移，不覆盖现有内容`);return;
    }
    // Build a complete template alongside the target, then rename on the same volume.
    const staging=path.join(this.entry.path,`.cbim-init-${this.instanceId}`);await fs.mkdir(staging);
    try{for(const folder of ['workspace','team','connectors'])await fs.mkdir(path.join(staging,folder));
      const initial:Record<string,unknown>={'project.json':{formatVersion:1,rulesVersion:1},'team/registry.json':{groups:[]},'team/people.json':{people:[]},'team/skills.json':{skills:[]},'workspace/registry.json':{modules:[]},'connectors/registry.json':{connectors:[]}};
      for(const [p,value]of Object.entries(initial))await atomic(path.join(staging,p),json(value));
      await atomic(path.join(staging,'README.md'),'# 团队 AI Native 工作流\n\n在此维护团队、AI 成员、业务模块和经 review 的正式知识。\n');
      if(await exists(dir))fail('CONFLICT','初始化期间出现 .cbim，请检查后重新打开');await fs.rename(staging,dir);
    }finally{await fs.rm(staging,{recursive:true,force:true})}
  }
  async read():Promise<Snapshot>{const files=await readKnowledge(this.paths,this.entry.path);return {workspaceId:this.entry.id,instanceId:this.instanceId,revision:revision(files),files}}
  async snapshot(){this.assert();const snapshot=await this.read();snapshot.validation=await this.rules.validate(this.entry.path,snapshot.files);
    for(const [p,text]of Object.entries(snapshot.validation.indexes)){const old=snapshot.files.find(f=>f.path===p);if(old?.text!==text)snapshot.validation.issues.push({severity:'warning',code:'index_stale',path:p,message:'派生注册表与知识定义不一致，可通过校验并更新索引修复'})}
    if(await exists(path.join(this.entry.path,'.cbim.local')))snapshot.validation.issues.push({severity:'warning',code:'legacy_local',path:'.cbim.local',message:'发现旧本地历史目录。请先备份并核对身份；未授权不会移动或删除。'});return snapshot}
  private serial<T>(operation:()=>Promise<T>):Promise<T>{const current=this.queue.then(operation);this.queue=current.catch(()=>{});return current}
  private async draft(request:ChangeRequest):Promise<Preview>{
    this.assert(request);if(!/^[A-Za-z0-9_-]{8,100}$/.test(request.requestId))fail('REQUEST_ID','请求标识须为 8–100 位字母、数字、下划线或横线');
    const snapshot=await this.read();if(snapshot.revision!==request.revision)fail('CONFLICT','知识已被外部修改，请重新读取并合并');
    const map=new Map(snapshot.files.map(f=>[f.path,f.text]));const seen=new Set<string>();
    for(const change of request.changes){await this.paths.knowledge(this.entry.path,change.path);if(!isKnowledge(change.path)||INDEXES.includes(change.path)||change.path==='.cbim/project.json')fail('TYPE','该路径不是可编辑的正式知识类型，索引与版本由程序维护');if(seen.has(change.path.toLowerCase()))fail('DUPLICATE','一个事务不能重复修改同一文件');seen.add(change.path.toLowerCase());if(change.text!==null&&Buffer.byteLength(change.text)>2*1024*1024)fail('SIZE','单文件不能超过 2 MiB');change.text===null?map.delete(change.path):map.set(change.path,change.text)}
    const projected=[...map].map(([p,text])=>({path:p,text,hash:hash(text)}));const validation=await this.rules.validate(this.entry.path,projected);
    const changes=[...request.changes];if(validation.structural)for(const [p,text]of Object.entries(validation.indexes))if(map.get(p)!==text)changes.push({path:p,text});
    const affected=snapshot.files.filter(f=>request.changes.some(c=>f.text.includes(c.path)||f.text.includes(path.posix.basename(c.path)))).map(f=>f.path);
    const diff=changes.map(c=>`--- ${c.path}\n${snapshot.files.find(f=>f.path===c.path)?.text||'(新建)'}\n+++ ${c.path}\n${c.text??'(删除)'}`).join('\n\n');
    return {request,changes,validation,affected,diff,fingerprint:hash(json(request))};
  }
  async preview(request:ChangeRequest){return this.serial(()=>this.draft(request))}
  async commit(request:ChangeRequest){this.assert(request);return this.serial(async()=>{
    this.assert(request);this.activeOperations++;
    try{
      const journalPath=path.join(this.paths.local(this.entry.id,'transactions'),request.requestId+'.json');
      if(await exists(journalPath)){const old=await readJson<Journal>(journalPath);if(old.fingerprint!==hash(json(request)))fail('IDEMPOTENCY','请求标识已用于不同变更');if(old.state==='committed'&&old.result)return old.result;fail('RECOVERY','此前请求未提交或已回滚，请重新读取后使用新请求标识')}
      const preview=await this.draft(request);if(!preview.validation.structural)fail('VALIDATION',preview.validation.issues.filter(x=>x.severity==='error').map(x=>`${x.path}: ${x.message}`).join('\n'));
      const current=await this.read();if(current.revision!==request.revision)fail('CONFLICT','校验期间知识已变化');
      const before:Record<string,string|null>={},after:Record<string,string|null>={};for(const c of preview.changes){before[c.path]=current.files.find(f=>f.path===c.path)?.text??null;after[c.path]=c.text}
      const journal:Journal={version:1,workspaceId:this.entry.id,requestId:request.requestId,fingerprint:preview.fingerprint,state:'prepared',before,after};await atomic(journalPath,json(journal));
      const expected=new Map(current.files.map(f=>[f.path,f]));journal.state='committing';await atomic(journalPath,json(journal));
      try{let n=0;for(const [p,text]of Object.entries(after)){
          const live=await this.read();if(live.revision!==revision([...expected.values()]))fail('CONFLICT','提交期间检测到外部修改，正在安全回滚');
          await this.write(p,text);if(text===null)expected.delete(p);else expected.set(p,{path:p,text,hash:hash(text)});this.fault?.(++n);
        }
        const final=await this.read();if(final.revision!==revision([...expected.values()]))fail('CONFLICT','提交末尾出现外部修改');
        const result={state:'committed',workspaceId:this.entry.id,instanceId:this.instanceId,requestId:request.requestId,revision:final.revision,changed:Object.keys(after)};
        journal.state='committed';journal.result=result;await atomic(journalPath,json(journal));this.lastRevision=final.revision;this.changed=false;await this.log('committed',{requestId:request.requestId,files:Object.keys(after).length});return result;
      }catch(e){await this.rollback(journal,journalPath);throw e}
    }finally{this.activeOperations--}
  })}
  private async write(relative:string,text:string|null){const target=await this.paths.knowledge(this.entry.path,relative);if(text===null)await fs.rm(target,{force:true});else await atomic(target,text)}
  private async rollback(journal:Journal,p:string){let blocked=false;
    for(const name of Object.keys(journal.after).reverse()){const target=await this.paths.knowledge(this.entry.path,name);const live=await exists(target)?await fs.readFile(target,'utf8'):null;if(live===journal.before[name])continue;if(live!==journal.after[name]){blocked=true;continue}try{await this.write(name,journal.before[name])}catch{blocked=true}}
    journal.state=blocked?'recovery_required':'rolled_back';await atomic(p,json(journal));if(blocked){this.state='recovery_required';this.error='恢复遇到外部修改，保留现场与事务证据，请人工合并后重新打开'}
  }
  private async recover(){const dir=this.paths.local(this.entry.id,'transactions');await fs.mkdir(dir,{recursive:true});for(const file of await fs.readdir(dir)){if(!file.endsWith('.json'))continue;const p=path.join(dir,file);const journal=await readJson<Journal>(p);if(journal.workspaceId!==this.entry.id)fail('IDENTITY','事务记录属于其他工程');if(['prepared','committing','recovery_required'].includes(journal.state)){await this.rollback(journal,p);if(journal.state==='recovery_required')fail('RECOVERY','未完成事务与外部修改冲突；请根据本地事务证据人工合并后重新打开')}}}
  async planMove(snapshot:Snapshot,from:string,to:string|null):Promise<ChangeRequest>{
    this.assert(snapshot);await this.paths.knowledge(this.entry.path,from);if(to)await this.paths.knowledge(this.entry.path,to);
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
    return {workspaceId:this.entry.id,instanceId:this.instanceId,revision:snapshot.revision,requestId:randomUUID(),changes};
  }
  startTask(name:'validate'|'reindex'){
    this.assert();const id=randomUUID(),controller=new AbortController();this.controllers.set(id,controller);const task:TaskView={id,workspaceId:this.entry.id,name,state:'running',progress:'读取知识并检查规则'};this.tasks.set(id,task);
    void (async()=>{try{await new Promise(r=>setTimeout(r,0));if(controller.signal.aborted)fail('CANCELLED','任务已取消');const snap=await this.snapshot();if(controller.signal.aborted)fail('CANCELLED','任务已取消');if(name==='reindex'){task.progress='提交索引；此阶段等待完成后关闭';task.result=await this.commit({workspaceId:this.entry.id,instanceId:this.instanceId,revision:snap.revision,requestId:id,changes:[]})}else task.result=snap.validation;task.state='completed';task.progress='检查结束：架构判断仍需团队 review'}catch(e:any){task.state=e.code==='CANCELLED'?'cancelled':'failed';task.error=e.message}finally{this.controllers.delete(id);await atomic(path.join(this.paths.local(this.entry.id,'task-records'),id+'.json'),json(task)).catch(()=>{})}})();return task;
  }
  cancelTask(id:string){this.controllers.get(id)?.abort();return this.tasks.get(id)}
  async localData(kind:'memory'|'task-records'|'logs'){const dir=this.paths.local(this.entry.id,kind);await fs.mkdir(dir,{recursive:true});return {source:'local',nature:kind,workspaceId:this.entry.id,files:await fs.readdir(dir)}}
  private async log(event:string,details:Record<string,unknown>={}){const directory=this.paths.local(this.entry.id,'logs');await fs.mkdir(directory,{recursive:true});await fs.appendFile(path.join(directory,'events.ndjson'),JSON.stringify({time:new Date().toISOString(),workspaceId:this.entry.id,instanceId:this.instanceId,event,...details})+'\n',{mode:0o600}).catch(()=>{})}
  private async clearDiscovery(){for(const p of [this.paths.discovery(this.entry.id),path.join(this.paths.project(this.entry.id),'credentials.json')])if(await exists(p)){try{const d=await readJson(p);if(d.instanceId===this.instanceId)await fs.rm(p,{force:true})}catch{}}}
  async close(){if(this.state==='closed')return;this.state='closing';if(this.watcher)clearInterval(this.watcher);for(const c of this.controllers.values())c.abort();await this.queue;while(this.controllers.size)await new Promise(r=>setTimeout(r,10));await this.closeTransport?.();await this.clearDiscovery();this.lock?.close();this.lock=undefined;this.state='closed';this.writable=false;await this.log('closed')}
}
