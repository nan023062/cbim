/**
 * 作用定位：把工作区静态团队能力或完整业务架构转为可复用资源包，并纯计算目标知识变更。
 * 设计原因：包只携带定义与闭合正文引用，人员、维护授权、源码定位和连接器绑定必须在目标项目重新建立；运行实例与主会话任务图不属于可复用架构。
 * 职责边界：不读取磁盘、不写知识、不授予权限。Workflow 条件随原正文保留并独立严格解析；完整目标 Schema/目录与引用规则仍由 KnowledgeWorkspace.preview/commit 统一验证。
 * 可复用 Team/Agent 包剔除本机 runtime 引用，避免把无效供应商身份带到另一台机器。
 */
import path from 'node:path';
import {z} from 'zod';
import {hash,json} from '../foundation/serialization';
import {parseJson} from '../foundation/json';
import {fail} from '../foundation/errors';
import {parseWorkflowContract} from '../workspace/workflow-contract';
import {INDEXES} from './knowledge';
import type {Snapshot,Change} from './types';

export type WorkspacePackageKind='team'|'agent'|'skill'|'architecture';
export type WorkspacePackageMode='add'|'replace';
/** path 是包内相对路径；不接受源工程绝对路径或成员/会话身份。 */
export interface WorkspacePackage {format:'cbim-workspace-package';version:1;kind:WorkspacePackageKind;name:string;summary:string;files:Array<{path:string;text:string}>;skill?:{name:string;purpose:string};fingerprint:string}
export interface PackageSelection {kind:WorkspacePackageKind;objectId?:string;name:string;summary:string}
export interface PackagePlacement {mode:WorkspacePackageMode;targetParentId?:string;slug?:string}
export interface PackageChanges {changes:Change[];targetRoot:string;createdRoots:string[];deletedRoots:string[];warnings:string[];removedBindings:string[]}
const pp=path.posix;
const packageShape=z.object({format:z.literal('cbim-workspace-package'),version:z.literal(1),kind:z.enum(['team','agent','skill','architecture']),name:z.string().trim().min(1).max(100),summary:z.string().trim().max(1000),files:z.array(z.object({path:z.string().min(1).max(1000),text:z.string().min(1).max(200000)}).strict()).min(1).max(512),skill:z.object({name:z.string().min(1),purpose:z.string().min(1)}).strict().optional(),fingerprint:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
const label=z.string().min(1),empty=z.array(z.never()).max(0),summary=label.refine(value=>{const n=Array.from(value.replace(/\s/g,'')).length;return value===value.trim()&&!/[\r\n]/.test(value)&&n>=100&&n<=250});
const skill=z.object({name:label,purpose:label,reference:z.string().regex(/^skills\/[^/]+\/SKILL\.md$/)}).strict();
const inventory=z.object({skills:z.array(skill)}).strict();
const agentDefinition=z.object({name:label,summary,authors:empty,capabilities:z.array(label).min(1),limitations:z.array(label),work_principles:label,skills:z.array(skill),connectors:empty}).strict();
const moduleDefinition=z.object({id:label,name:z.string().regex(/^(?:[0-9]+_)?[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/),summary,authors:empty,sources:empty,connectors:empty,children:z.array(label),overview:z.literal('module.md'),workflows:z.array(z.object({name:label,reference:z.string().regex(/^workflows\/[a-z][a-z0-9]*(?:_[a-z0-9]+)*\/workflow\.md$/)}).strict())}).strict();
const removed=['不携带真人花名册、账号和凭据','清除作者、连接器和模块维护关系绑定','清除业务源码目录定位；导入后须在目标项目重新确认'];
function check(condition:unknown,message:string):asserts condition{if(!condition)fail('RESOURCE_PACKAGE',message)}
function ordered(value:unknown):unknown{return Array.isArray(value)?value.map(ordered):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,ordered(item)])):value}
/** 指纹涵盖所有静态定义；不覆盖或传递任何执行授权。 */
export function workspacePackageFingerprint(value:Omit<WorkspacePackage,'fingerprint'>|WorkspacePackage){const {fingerprint:_,...body}=value as WorkspacePackage;return hash(JSON.stringify(ordered(body)))}
function cleanPath(value:string){return value===value.trim()&&!/[\\:\x00-\x1f?#%<>"|*]/.test(value)&&!value.startsWith('/')&&value.split('/').every(part=>part&&part!=='.'&&part!=='..'&&!part.endsWith('.')&&!part.endsWith(' ')&&!/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))}
/** Markdown 代码块内只是示例；只解析真实链接，不把路径字符串自动变成外部读取。 */
function links(text:string,replace:(link:string)=>string){let fence='';return text.split('\n').map(line=>{const mark=line.match(/^ {0,3}(`{3,}|~{3,})/);if(mark){if(!fence)fence=mark[1][0];else if(mark[1][0]===fence)fence='';return line}if(fence)return line;return line.replace(/(\]\(<?)([^\s)>]+)(>?(?:\s+"[^"]*")?\))/g,(_,a,link,b)=>a+replace(link)+b).replace(/^(\s*\[[^\]]+\]:\s*<?)([^\s>]+)(>?)/,(_,a,link,b)=>a+replace(link)+b)}).join('\n')}
function localReference(owner:string,reference:string):string|undefined{
  if(reference.startsWith('#'))return;
  if(/^[a-z][a-z0-9+.-]*:/i.test(reference)){
    let url:URL;try{url=new URL(reference)}catch{fail('RESOURCE_PACKAGE','正文包含无效链接')}
    check(['https:','http:'].includes(url.protocol)&&!url.username&&!url.password&&!/[?&](?:api[_-]?key|token|access_token|secret|password)=/i.test(reference),'资源正文不能携带本机地址或凭据链接');return;
  }
  const clean=reference.split('#')[0];check(!/[\\\x00-\x1f:?%]/.test(clean)&&!clean.startsWith('/'),'正文引用必须是包内相对路径');
  return pp.normalize(pp.join(owner,clean));
}
function exactObject(text:string,schema:z.ZodTypeAny){let value:unknown;try{value=parseJson(text)}catch{fail('RESOURCE_PACKAGE','资源包包含无效 JSON 定义')}const result=schema.safeParse(value);check(result.success,'资源定义无效或携带项目绑定/未允许字段');return result.data as any}

/** 严格校验外部包，含大小、路径、大小写冲突、封闭引用、目录树以及不允许的项目字段。 */
export function parseWorkspacePackage(content:string,kind?:string):WorkspacePackage{
  check(Buffer.byteLength(content)<=2*1024*1024,'资源包超过 2 MiB 限制');let decoded:unknown;try{decoded=parseJson(content)}catch{fail('RESOURCE_PACKAGE','该资源不是可导入的 CBIM 静态架构包')}
  const result=packageShape.safeParse(decoded);check(result.success,'资源包格式、版本或字段无效');const pack=result.data;
  check(!kind||pack.kind===kind,'资源类型与包内声明不一致');check(workspacePackageFingerprint(pack)===pack.fingerprint,'资源包完整性校验失败');
  check(pack.kind==='skill'?!!pack.skill:!pack.skill,'独立 Skill 元数据与资源类型不一致');
  const prefix=pack.kind==='architecture'?'workspace':pack.kind,files=new Map(pack.files.map(file=>[file.path,file.text])),folded=new Set<string>(),agents:string[]=[],modules=new Map<string,any>(),entries=new Set<string>(),reachable=new Set<string>(),roots:string[]=[];
  for(const file of pack.files){
    check(cleanPath(file.path)&&file.path.startsWith(prefix+'/'),'包内路径越界或格式无效');check(!folded.has(file.path.toLowerCase()),'资源包存在大小写冲突或重复路径');folded.add(file.path.toLowerCase());
    check(!file.path.split('/').some(part=>['people.json','registry.json','project.json','config.json','settings.json','session.json','.claude','.codex','archive','node_modules','logs','sessions','credentials','secrets'].includes(part.toLowerCase())),'资源包包含配置、人员或运行数据');
    const owner=pp.dirname(file.path);
    if(file.path.endsWith('/agent.json')){
      check(['team','agent'].includes(pack.kind)&&owner!=='team','业务或 Skill 包不能包含 Agent，Team 根也不能是 Agent');const data=exactObject(file.text,agentDefinition);agents.push(owner);
      const target=localReference(owner,data.work_principles);check(target&&files.has(target),'Agent 原则引用不完整');roots.push(target);reachable.add(file.path);
      for(const item of data.skills){const target=localReference(owner,item.reference);check(target&&files.has(target),'Agent Skill 引用不完整');entries.add(target)}
    }else if(file.path.endsWith('/skills.json')){
      check(pack.kind==='team','仅完整团队包可以包含小组 Skill 清单');const data=exactObject(file.text,inventory);reachable.add(file.path);for(const item of data.skills){const target=localReference(owner,item.reference);check(target&&files.has(target),'团队 Skill 引用不完整');entries.add(target)}
    }else if(file.path.endsWith('/module.json')){
      check(pack.kind==='architecture','团队能力包不能包含业务模块');const data=exactObject(file.text,moduleDefinition);check(data.id===owner&&data.name===pp.basename(owner),'模块身份与包内目录不一致');modules.set(owner,data);check(files.has(owner+'/module.md'),'模块缺少完整概览');roots.push(owner+'/module.md');reachable.add(file.path);
      for(const item of data.workflows){const target=localReference(owner,item.reference);check(target&&files.has(target),'模块 Workflow 引用不完整');entries.add(target)}
    }else check(file.path.endsWith('.md'),'包只允许静态正文和已知定义，不允许任意 JSON 配置或可执行文件');
    if(file.path.endsWith('.md')){
      if(file.path.endsWith('/workflow.md'))try{parseWorkflowContract(file.text)}catch{fail('RESOURCE_PACKAGE','资源包的 Workflow 执行约定无效')}
      check(!/(?:sk-[a-zA-Z0-9_-]{16,}|gh[pousr]_[a-zA-Z0-9]{20,}|-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----)/.test(file.text),'正文疑似包含真实凭据，不能发布到资源仓库');
      check(!/\.cbim\/(?:team|workspace|connectors)\/[a-z0-9_-]/i.test(file.text),'正文仍绑定源工程对象，请改为可移植的相对引用再发布');
      links(file.text,link=>{const target=localReference(owner,link);check(!target||target.startsWith(prefix+'/')&&files.has(target),'正文引用未包含在此静态资源包中');return link});
    }
  }
  for(const owner of agents)check(!agents.some(other=>other!==owner&&other.startsWith(owner+'/')),'Agent 必须是团队叶子');
  for(const [id,data] of modules){check(new Set(data.children).size===data.children.length,'模块子节点重复');for(const child of data.children)check(modules.has(child)&&pp.dirname(child)===id,'模块 children 未形成完整包含树');const parent=modules.get(pp.dirname(id));check(pp.dirname(id)==='workspace'||parent,'完整业务架构不能缺少上级模块');check(!parent||parent.children.includes(id),'父模块漏记直属子模块')}
  for(const file of pack.files)if(file.path.endsWith('/SKILL.md')||file.path.endsWith('/workflow.md'))check(pack.kind==='skill'&&file.path==='skill/SKILL.md'||entries.has(file.path),'方法正文没有归属清单');
  check(pack.kind!=='agent'||agents.length===1&&files.has('agent/agent.json'),'独立 Agent 包须恰好包含一个根 Agent');check(pack.kind!=='skill'||files.has('skill/SKILL.md'),'独立 Skill 包缺少入口');check(pack.kind!=='architecture'||modules.size>0,'业务模板必须包含完整业务架构，不能是空包或单个 Workflow');check(pack.kind!=='team'||agents.length>0||entries.size>0,'团队资源没有成员或 Skill 定义');
  roots.push(...entries,...(pack.kind==='skill'?['skill/SKILL.md']:[]));
  for(let index=0;index<roots.length;index++){const current=roots[index];if(reachable.has(current))continue;reachable.add(current);links(files.get(current)!,link=>{const target=localReference(pp.dirname(current),link);if(target&&!reachable.has(target))roots.push(target);return link})}
  check(pack.files.every(file=>reachable.has(file.path)),'资源包包含未归属的正文，不能附带隐藏文件');
  return pack;
}

/** 从已经通过工作区规则校验的知识创建包；独立 Agent 会冻结其实际可用的继承 Skill。 */
export function buildWorkspacePackage(snapshot:Snapshot,selection:PackageSelection):{package:WorkspacePackage;warnings:string[];removedBindings:string[]}{
  check(snapshot.validation?.structural,'源工作区知识尚有结构错误，请先处理后发布');
  const source=new Map(snapshot.files.map(file=>[file.path,file.text])),mapping=new Map<string,string>(),output=new Map<string,string>();
  const prefix=selection.kind==='architecture'?'workspace':selection.kind,scope=selection.kind==='architecture'?'.cbim/workspace':'.cbim/team';
  const read=(id:string)=>{const text=source.get(id);check(text!==undefined,'要发布的静态对象不存在');return text};
  const get=(id:string)=>parseJson(read(id));
  const put=(from:string,to:string,text:string)=>{const existing=[...mapping].find(([,target])=>target.toLowerCase()===to.toLowerCase());check(!existing||existing[0]===from,'包内方法或路径名称冲突');mapping.set(from,to);output.set(to,text)};
  const documents:Array<{from:string;to:string}>=[];
  const enqueue=(from:string,to:string)=>{if(mapping.has(from))return;check(from.startsWith(scope+'/')&&from.endsWith('.md'),'正文引用超出可复用静态领域，不能打包业务源码、配置或人员');put(from,to,read(from));documents.push({from,to})};
  const addInventory=(owner:string,to:string,data:any)=>{
    for(const item of data.skills??[]){const from=localReference(owner,item.reference);check(from,'Skill 入口必须是静态相对引用');enqueue(from,to+'/'+item.reference)}
  };
  let skillInfo:WorkspacePackage['skill'];
  if(selection.kind==='team'){
    check(!selection.objectId||selection.objectId==='.cbim/team','团队架构发布必须选择完整 Team');
    const index=snapshot.validation!.indexes['.cbim/team/registry.json'];const groups=index?parseJson(index).groups:[];
    for(const group of [{id:'.cbim/team'},...groups])if(!source.has(group.id+'/skills.json'))source.set(group.id+'/skills.json',json({skills:[]}));
    for(const [from,text] of source)if(from.startsWith(scope+'/')&&(from.endsWith('/agent.json')||from.endsWith('/skills.json'))){
      const data=parseJson(text),owner=pp.dirname(from),to='team'+from.slice(scope.length);
      if(from.endsWith('/agent.json')){delete data.runtime;data.authors=[];data.connectors=[];const target=localReference(owner,data.work_principles);check(target,'原则必须是静态正文');enqueue(target,'team'+target.slice(scope.length))}
      put(from,to,json(data));addInventory(owner,pp.dirname(to),data);
    }
  }else if(selection.kind==='agent'){
    const id=selection.objectId;check(id&&id.startsWith(scope+'/')&&cleanPath(id),'发布 Agent 必须指定当前团队的角色对象');const data=get(id+'/agent.json');
    const principles=localReference(id,data.work_principles);check(principles,'Agent 原则入口无效');enqueue(principles,'agent/principles.md');
    delete data.runtime;data.authors=[];data.connectors=[];data.work_principles='principles.md';data.skills=[];
    for(const item of snapshot.validation!.skills?.[id]?.entries??[]){const slug=pp.basename(pp.dirname(item.reference));const reference='skills/'+slug+'/SKILL.md';data.skills.push({name:item.name,purpose:item.purpose,reference});enqueue(item.reference,'agent/'+reference)}
    put(id+'/agent.json','agent/agent.json',json(data));
  }else if(selection.kind==='skill'){
    const requested=selection.objectId;check(requested&&cleanPath(requested),'发布 Skill 必须指定静态方法对象');const entry=requested.endsWith('/SKILL.md')?requested:requested+'/SKILL.md',split=entry.lastIndexOf('/skills/');check(split>=0,'Skill 标识无效');
    const owner=entry.slice(0,split),definition=source.has(owner+'/agent.json')?get(owner+'/agent.json'):get(owner+'/skills.json');
    const item=definition.skills.find((item:any)=>localReference(owner,item.reference)===entry);check(item,'Skill 未登记在归属节点清单');skillInfo={name:item.name,purpose:item.purpose};enqueue(entry,'skill/SKILL.md');
  }else{
    check(!selection.objectId||selection.objectId==='.cbim/workspace','业务模板只能发布完整业务架构，不能选择单 Module 或 Workflow');
    for(const [from,text] of source)if(from.startsWith(scope+'/')&&from.endsWith('/module.json')){
      const data=parseJson(text),owner=pp.dirname(from),to='workspace'+from.slice(scope.length),locations=data.sources.map((item:any)=>item.location);
      data.id='workspace'+owner.slice(scope.length);data.children=data.children.map((id:string)=>'workspace'+id.slice(scope.length));data.authors=[];data.connectors=[];data.sources=[];delete data.maintenance;
      put(from,to,json(data));enqueue(owner+'/module.md',pp.dirname(to)+'/module.md');
      // Source 小节不携带旧工程路径。保留职责说明和图，让目标项目重新登记定位。
      const overview=output.get(pp.dirname(to)+'/module.md')!;output.set(pp.dirname(to)+'/module.md',overview.split('\n').map(line=>locations.some((location:string)=>line.replace(/^#{3,6}\s+/,'').replaceAll('`','').trim()===location)?'待在目标项目重新绑定源码范围。':locations.reduce((value:string,location:string)=>value.split(location).join('待绑定源码目录'),line)).join('\n'));
      for(const item of data.workflows){const entry=localReference(owner,item.reference);check(entry,'Workflow 入口无效');enqueue(entry,pp.dirname(to)+'/'+item.reference)}
    }
  }
  // 递归纳入正文依赖；仅允许当前静态领域的 Markdown，禁止偷偷收进连接器配置或业务代码。
  for(let cursor=0;cursor<documents.length;cursor++){
    const {from,to}=documents[cursor];links(output.get(to)!,reference=>{
      const target=localReference(pp.dirname(from),reference);if(!target)return reference;
      if(!mapping.has(target)){const relative=pp.relative(pp.dirname(from),target),destination=!relative.startsWith('../')?pp.join(pp.dirname(to),relative):prefix+'/references/'+hash(target).slice(0,10)+'-'+pp.basename(target);enqueue(target,destination)}return reference;
    });
  }
  for(const {from,to} of documents)output.set(to,links(output.get(to)!,reference=>{const target=localReference(pp.dirname(from),reference);if(!target)return reference;const destination=mapping.get(target);check(destination,'正文引用不完整');const anchor=reference.includes('#')?'#'+reference.split('#').slice(1).join('#'):'';return pp.relative(pp.dirname(to),destination)+anchor}));
  const body={format:'cbim-workspace-package' as const,version:1 as const,kind:selection.kind,name:selection.name,summary:selection.summary,files:[...output].sort(([a],[b])=>a.localeCompare(b)).map(([path,text])=>({path,text})),...(skillInfo?{skill:skillInfo}:{})};
  const pack={...body,fingerprint:workspacePackageFingerprint(body)};parseWorkspacePackage(json(pack),selection.kind);
  return {package:pack,warnings:['仅发布静态定义；请 review 正文，确认适用于其他项目。',...(selection.kind==='agent'?['独立 Agent 已将可用祖先 Skill 收入自身能力，导入时仍会检查与目标祖先的名称冲突。']:[])],removedBindings:[...removed]};
}

/** 计算整包导入差异；能力默认新增，业务只允许完整根导入或显式整体替换。 */
export function planWorkspacePackage(snapshot:Snapshot,pack:WorkspacePackage,placement:PackagePlacement):PackageChanges{
  parseWorkspacePackage(json(pack),pack.kind);
  const original=new Map(snapshot.files.map(file=>[file.path,file.text])),target=new Map(original),createdRoots:string[]=[],deletedRoots:string[]=[];
  const slug=placement.slug,parent=placement.targetParentId??'.cbim/team';let targetRoot:string;
  const group=(id:string)=>id==='.cbim/team'||snapshot.validation?.indexes['.cbim/team/registry.json']&&parseJson(snapshot.validation.indexes['.cbim/team/registry.json']).groups.some((group:any)=>group.id===id);
  if(pack.kind==='architecture'){
    check(!placement.targetParentId&&!slug,'业务架构只能整体导入，不能指定某个模块或子目录');targetRoot='.cbim/workspace';
    const occupied=[...original.keys()].some(id=>id.startsWith(targetRoot+'/')&&!INDEXES.includes(id));check(!occupied||placement.mode==='replace','目标已有业务架构，必须明确选择整体替换并预览');
  }else if(pack.kind==='team'&&placement.mode==='replace'){
    check((!placement.targetParentId||placement.targetParentId==='.cbim/team')&&!slug,'完整 Team 替换只能作用于工作区团队根');targetRoot='.cbim/team';
  }else{
    check(placement.mode==='add','独立 Agent 和 Skill 只支持新增，不覆盖已有定义');
    check(slug&&cleanPath(slug)&&/^[a-z][a-z0-9]*(?:[_-][a-z0-9]+)*$/.test(slug)&&!['skills','workflows','references','scripts','assets','archive','node_modules'].includes(slug),'新增资源须指定有效且未使用的 slug');
    check(cleanPath(parent)&&parent.startsWith('.cbim/team'),'能力包只能导入团队领域');
    check(pack.kind==='skill'?(group(parent)||original.has(parent+'/agent.json')):group(parent)&&!original.has(parent+'/agent.json'),'目标归属必须是当前 Team/小组，Skill 也可以属于 Agent');
    targetRoot=parent+(pack.kind==='skill'?'/skills/':'/')+slug;
    check(![...original.keys()].some(id=>id.toLowerCase()===targetRoot.toLowerCase()||id.toLowerCase().startsWith(targetRoot.toLowerCase()+'/')),'目标名称或目录已存在，不能覆盖');createdRoots.push(targetRoot);
  }
  // 废弃花名册仍属用户历史文件，整组替换不删除它，也不再核实旧人员的团队引用。
  const protectedFile=(id:string)=>INDEXES.includes(id)||id==='.cbim/team/people.json';
  if(placement.mode==='replace'){
    deletedRoots.push(targetRoot);for(const id of target.keys())if(id.startsWith(targetRoot+'/')&&!protectedFile(id))target.delete(id);
  }
  const prefix=pack.kind==='architecture'?'workspace':pack.kind;
  for(const file of pack.files){const destination=targetRoot+file.path.slice(prefix.length);let text=file.text;
    if(file.path.endsWith('/module.json')){const data=parseJson(text);data.id='.cbim/'+data.id;data.children=data.children.map((id:string)=>'.cbim/'+id);text=json(data)}
    target.set(destination,text);
  }
  if(pack.kind==='skill'){
    const ownerFile=original.has(parent+'/agent.json')?parent+'/agent.json':parent+'/skills.json',data=target.has(ownerFile)?parseJson(target.get(ownerFile)!):{skills:[]};
    check(!data.skills.some((item:any)=>item.name.toLowerCase()===pack.skill!.name.toLowerCase()),'目标已登记同名 Skill');data.skills.push({...pack.skill,reference:'skills/'+slug+'/SKILL.md'});target.set(ownerFile,json(data));
  }
  const changes=[...new Set([...original.keys(),...target.keys()])].filter(id=>!protectedFile(id)&&original.get(id)!==target.get(id)).map(id=>({path:id,text:target.get(id)??null}));
  check(changes.length>0,'资源包与目标定义相同，没有需要提交的变更');
  return {changes,targetRoot,createdRoots,deletedRoots,removedBindings:[...removed],warnings:['只更新当前工作区静态架构，不迁移成员实例、任务或主会话。','源项目的历史人员／维护字段和连接器绑定不会继承；执行岗位及模块负责人仍由目标项目明确配置。',...(placement.mode==='replace'?['整体替换会删除预览清单中的旧静态定义；业务源码和资源不在删除范围。']:[])]};
}
