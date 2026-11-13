/**
 * 作用定位：Core 知识规则：校验领域结构、专业正文和引用，并派生注册索引。
 * 设计原因：调度、桌面和外部适配共用规则；模块 Workflow 的显式程序条件不能绕过完整事务校验。Ajv 使用不改变字段值的兼容副本，原严格 JSON 解析仍保留危险键和重复键拒绝。历史作者和维护声明不再关联真人花名册；结构校验不签发执行或架构批准。
 * 机制边界：存在探测复用独立文件基础库；知识路径、验证和索引语义仍由本模块决定。
 */
import fs from 'node:fs/promises';
import {ConnectorRegistry} from '../connectors/registry';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020';
import ignore from 'ignore';
import {hash,json} from '../foundation/serialization';
import {exists} from '../../../foundations/files';
import {parseWorkflowContract} from '../workspace/workflow-contract';
import {moduleSections,moduleBodyTemplate} from '../workspace/module-outline';
import type {KnowledgeFile,Validation,Issue,ModuleNode} from './types';
import {parseJson} from '../foundation/json';
export {parseJson} from '../foundation/json';
const pp=path.posix;
export const INDEXES=['.cbim/team/registry.json','.cbim/workspace/registry.json'];
export const excluded=new Set(['archive','_unassigned','__pycache__','.git','node_modules']);
export const revision=(files:KnowledgeFile[])=>hash(files.map(f=>`${f.path}\0${f.hash}`).sort().join('\n'));
export function isKnowledge(relative:string){
  // 废弃入口不再作为知识发布或写入；旧文件保留在磁盘，不自动覆盖或迁移。
  if(relative.toLowerCase()==='.cbim/entry.md')return false;
  if(relative==='.cbim/project.json'||relative==='.cbim/.cbimignore')return true;
  if(!relative.startsWith('.cbim/'))return false;
  if(relative.split('/').some(x=>excluded.has(x)))return false;
  return /^\.cbim\/(workspace|team|connectors)\/.+\.(json|md)$/.test(relative)||/^\.cbim\/[^/]+\.md$/.test(relative);
}
export class Rules {
  private validators=new Map<string,ReturnType<Ajv2020['compile']>>();
  constructor(readonly designRoot:string){}
  async init(){const ajv=new Ajv2020({allErrors:true,strict:false});for(const [key,file] of Object.entries({module:'business/module.schema.json',agent:'capability/agent.schema.json',skills:'capability/team-skills.schema.json',connectors:'connector/registry.schema.json'}))this.validators.set(key,ajv.compile(parseJson(await fs.readFile(path.join(this.designRoot,file),'utf8'))))}
  /** 对传入的完整候选知识校验并派生索引；读取 source 存在性但不修改业务工程。 */
  async validate(root:string,files:KnowledgeFile[]):Promise<Validation>{
    const texts=new Map(files.map(f=>[f.path,f.text]));const parsed=new Map<string,any>();const issues:Issue[]=[];
    const add=(p:string,code:string,message:string,severity:'error'|'warning'='error')=>issues.push({path:p,code,message,severity});
    const data=(p:string)=>parsed.get(p);
    // 废弃花名册只保留原始字节，不解析其内容或据此阻断旧项目；其他 JSON 仍严格校验。
    for(const file of files)if(file.path.endsWith('.json')&&file.path!=='.cbim/team/people.json')try{parsed.set(file.path,parseJson(file.text))}catch(e:any){add(file.path,'json',e.message)}
    for(const file of files)if(file.path.startsWith('.cbim/workspace/')&&file.path.endsWith('/workflow.md'))try{parseWorkflowContract(file.text)}catch{add(file.path,'workflow_contract','Workflow 执行约定无效：请核对唯一的 cbim-workflow 块及版本、条件、工具和证据 ID')}
    const schema=(p:string,key:string)=>{const value=data(p);if(value===undefined){add(p,'missing','缺少有效知识定义');return false}const validator=this.validators.get(key)!;
      // 严格解析产出无原型对象；Ajv 的 uniqueItems 比较依赖 Object.prototype。
      // clone 仅给校验器恢复普通对象原型，不删除 own key、不经 JSON 再编码改变数值，也不修改查询使用的原事实。
      // 畸形 own valueOf/toString/constructor 仍须拒绝；第三方比较器不能把这类输入变成未处理异常。
      try{if(!validator(structuredClone(value))){for(const error of validator.errors||[])add(p,'schema',`${error.instancePath} ${error.message}`);return false}}
      catch{add(p,'schema','知识定义包含校验器无法处理的无效结构');return false}return true};
    const ref=(owner:string,reference:string)=>{const target=pp.normalize(pp.join(owner,reference.split('#')[0]));if(!target.startsWith('.cbim/')||!texts.has(target))add(owner,'reference',`引用不存在或越界：${reference}`);return target};
    const summary=(p:string,s:string)=>{const length=Array.from(s.replace(/\s/g,'')).length;if(s!==s.trim()||/[\r\n]/.test(s)||length<100||length>250)add(p,'summary','摘要须为 100–250 个非空白字符的单行文本')};
    const modules=new Map<string,any>(),agents=new Map<string,any>();const groups=new Set<string>();const sourceRows:{module:string;key:string;scope:string;location:string}[]=[];
    let connectorIds=new Set<string>();
    if(schema('.cbim/connectors/registry.json','connectors')){
      const registry=new ConnectorRegistry(data('.cbim/connectors/registry.json').connectors);
      connectorIds=registry.ids();for(const _id of registry.duplicates())add('.cbim/connectors/registry.json','duplicate','链接器标识或提供方身份重复');
    }
    let ignores=ignore({ignorecase:true});try{ignores=ignores.add(texts.get('.cbim/.cbimignore')||'')}catch(e:any){add('.cbim/.cbimignore','ignore',e.message)}
    const idSeen=new Set<string>();
    for(const f of files){const kind=f.path.endsWith('/module.json')&&f.path.startsWith('.cbim/workspace/')?'module':f.path.endsWith('/agent.json')&&f.path.startsWith('.cbim/team/')?'agent':undefined;if(!kind)continue;
      if(!schema(f.path,kind))continue;const d=data(f.path),id=pp.dirname(f.path);const folded=id.toLowerCase();if(idSeen.has(folded))add(f.path,'duplicate','标识不区分大小写时重复');idSeen.add(folded);summary(f.path,d.summary);
      for(const c of d.connectors)if(!connectorIds.has(c.toLowerCase()))add(f.path,'connector',`未登记连接器：${c}`);
      if(kind==='agent'){agents.set(id,d);ref(id,d.work_principles);continue}
      modules.set(id,d);if(d.id!==id)add(f.path,'identity','id 必须与模块目录一致');if(!/^(?:[0-9]+_)?[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/.test(d.name)||pp.basename(id)!==d.name)add(f.path,'name','模块目录和名称须一致并使用小写 snake_case');
      // 旧 maintenance 仅保留为历史描述，不再生成关系、核实真人或作为执行门禁。
      ref(id,d.overview);this.body(id,d,texts.get(id+'/module.md')||'',add);
      const actual=files.filter(x=>x.path.startsWith(id+'/workflows/')&&x.path.endsWith('/workflow.md')).map(x=>x.path);
      this.inventory(id,d.workflows,actual,ref,add,'workflow');
      for(const source of d.sources){const location=source.location.replaceAll('\\','/');if(!source.scope.trim()||!location||location!==location.trim()||location==='.'||location.startsWith('/')||location.split('/').includes('..')||/[:*?\[\]\x00]/.test(location)){add(f.path,'source','source 必须是项目内具体目录，scope 不能为空');continue}
        const target=path.resolve(root,location);let resolved=target;
        try{resolved=await fs.realpath(target);const rel=path.relative(root,resolved);if(rel.startsWith('..')||path.isAbsolute(rel))add(f.path,'source','source 链接越出项目');if(!(await fs.stat(resolved)).isDirectory())add(f.path,'source','source 不允许引用文件')}
        catch(e:any){if(e.code==='ENOENT')add(f.path,'source_missing',`目录尚不存在，需核实：${location}`,'warning');else add(f.path,'source',e.message)}
        if(ignores.ignores(location+'/'))add(f.path,'source_ignored',`source 命中忽略规则：${location}`);
        else sourceRows.push({module:id,key:resolved.replaceAll('\\','/').toLowerCase(),location,scope:source.scope});
      }
    }
    groups.add('.cbim/team');for(const f of files.filter(x=>x.path.startsWith('.cbim/team/'))){let owner=pp.dirname(f.path);const special=owner.match(/^(.*)\/(skills|references|assets|scripts)(?:\/|$)/);if(special)owner=special[1];if(agents.has(owner))owner=pp.dirname(owner);while(owner.startsWith('.cbim/team')){if(!agents.has(owner))groups.add(owner);if(owner==='.cbim/team')break;owner=pp.dirname(owner)}}
    // Also discover empty Teams when validating the live project; empty groups remain indexed.
    const walkTeams=async(folder:string)=>{try{for(const d of await fs.readdir(path.join(root,folder),{withFileTypes:true})){if(!d.isDirectory()||d.name.startsWith('.')||excluded.has(d.name)||['skills','references','assets','scripts'].includes(d.name))continue;const id=folder+'/'+d.name;if(!agents.has(id)){if(await exists(path.join(root,id,'agent.json')))continue;groups.add(id);await walkTeams(id)}}}catch{}};await walkTeams('.cbim/team');
    for(const [id] of agents){for(const other of agents.keys())if(other!==id&&other.startsWith(id+'/'))add(other+'/agent.json','team_leaf','Agent 必须是叶子，不能包含其他 Agent');if(id==='.cbim/team')add(id+'/agent.json','team_root','Team 根不能是 Agent')}
    const inventories=new Map<string,any[]>();
    for(const owner of new Set([...groups,...agents.keys()])){
      const own=agents.get(owner);const p=owner+(own?'/agent.json':'/skills.json');let list:any[]=own?.skills||[];
      if(!own&&texts.has(p)){if(schema(p,'skills'))list=data(p).skills}
      const actual=files.filter(f=>f.path.startsWith(owner+'/skills/')&&f.path.endsWith('/SKILL.md')).map(f=>f.path);
      this.inventory(owner,list,actual,ref,add,'skill');inventories.set(owner,list);
    }
    const skills:NonNullable<Validation['skills']>={};
    for(const [agent] of agents){let owner=agent;const seen=new Map<string,string>();const chain:string[]=[],entries:NonNullable<Validation['skills']>[string]['entries']=[];while(owner.startsWith('.cbim/team')){chain.push(owner);for(const skill of inventories.get(owner)||[]){entries.push({...skill,reference:owner+'/'+skill.reference,owner,scope:owner===agent?'agent':'team'});for(const key of ['name:'+skill.name.toLowerCase(),'slug:'+pp.basename(pp.dirname(skill.reference)).toLowerCase()]){if(seen.has(key))add(agent+'/agent.json','skill_conflict',`继承冲突：${owner}/${skill.reference} 与 ${seen.get(key)}`);seen.set(key,owner+'/'+skill.reference)}}if(owner==='.cbim/team')break;owner=pp.dirname(owner)}skills[agent]={chain,entries}}
    const nodes:Record<string,ModuleNode>={},parents=new Map<string,string>();for(const [id,d] of modules){nodes[id]={id,name:d.name,summary:d.summary,sources:d.sources,children:d.children};for(const child of d.children){if(!modules.has(child))add(id+'/module.json','child',`子模块不存在：${child}`);if(parents.has(child))add(id+'/module.json','parent',`子模块有多个父节点：${child}`);parents.set(child,id);if(pp.dirname(child)!==id)add(id+'/module.json','hierarchy','children 必须与已确认的模块目录层级一致')}}
    for(const id of modules.keys()){const parent=pp.dirname(id);if(modules.has(parent)&&parents.get(id)!==parent)add(id+'/module.json','child_missing','父模块未声明该直属子模块')}
    for(const id of modules.keys()){const visited=new Set<string>();let p:string|undefined=id;while(p){if(visited.has(p)){add(id+'/module.json','cycle','模块包含关系存在循环');break}visited.add(p);p=parents.get(p)}}
    const ancestor=(child:string,parent:string)=>{const seen=new Set<string>();let current=parents.get(child);while(current&&!seen.has(current)){if(current===parent)return true;seen.add(current);current=parents.get(current)}return false};
    for(let i=0;i<sourceRows.length;i++)for(const b of sourceRows.slice(i+1)){const a=sourceRows[i];if(a.key===b.key)add(a.module+'/module.json','source_duplicate',`${a.location} 与 ${b.module} 重复声明`);else if(a.key.startsWith(b.key+'/')||b.key.startsWith(a.key+'/')){const aligned=(ancestor(a.module,b.module)&&a.key.startsWith(b.key+'/'))||(ancestor(b.module,a.module)&&b.key.startsWith(a.key+'/'));if(!aligned)add(a.module+'/module.json','source_overlap',`${a.location} 与 ${b.module} / ${b.location} 存在跨分支或冗余包含，需 review`,'warning')}}
    const indexes:Record<string,string>={};indexes[INDEXES[1]]=json({modules:[...modules].filter(([id])=>!ignores.ignores(id+'/')).map(([id,d])=>({id,summary:d.summary})).sort((a,b)=>a.id.localeCompare(b.id))});
    indexes[INDEXES[0]]=json({groups:[...groups].sort().filter(g=>g!=='.cbim/team'||[...agents.keys()].some(a=>pp.dirname(a)===g)).map(id=>({id,agents:[...agents].filter(([a])=>pp.dirname(a)===id).map(([a,d])=>({id:a,summary:d.summary})).sort((a,b)=>a.id.localeCompare(b.id))}))});
    // Markdown references are checked against the projected transaction, so deletion
    // cannot pass merely because the old target still exists on disk.
    for(const file of files.filter(f=>f.path.endsWith('.md'))){const prose=file.text.replace(/(`{3,}|~{3,})[^\n]*\n[\s\S]*?\1/g,'');const links=[...prose.matchAll(/\]\(<?([^\s)>]+)>?(?:\s+"[^"]*")?\)/g),...prose.matchAll(/^\s*\[[^\]]+\]:\s*<?([^\s>]+)>?/gm)];for(const match of links){const link=match[1];if(link.startsWith('#')||/^[a-z][a-z0-9+.-]*:/i.test(link))continue;const target=pp.normalize(pp.join(pp.dirname(file.path),link.split('#')[0]));if(target.startsWith('../')||target.startsWith('/'))add(file.path,'reference','Markdown 引用越出工程');else if(target.startsWith('.cbim/')){if(!texts.has(target)&&!files.some(x=>x.path.startsWith(target+'/'))){let assetExists=false;if(!/\.(md|json)$/i.test(target))try{const resolved=await fs.realpath(path.join(root,target));const rel=path.relative(path.join(root,'.cbim'),resolved);assetExists=!rel.startsWith('..')&&!path.isAbsolute(rel)}catch{}if(!assetExists)add(file.path,'reference',`Markdown 引用不存在：${link}`)}}else if(!await exists(path.join(root,target)))add(file.path,'reference',`项目引用不存在：${link}`)}}
    return {issues,indexes,skills,tree:{nodes,roots:[...modules.keys()].filter(id=>!parents.has(id)).sort()},structural:!issues.some(x=>x.severity==='error'),architecture:'review-required',business:'not-run'};
  }
  private inventory(owner:string,list:any[],actual:string[],ref:(o:string,r:string)=>string,add:(p:string,c:string,m:string)=>void,kind:string){
    const paths=new Set<string>(),names=new Set<string>();for(const item of list){const p=ref(owner,item.reference);if(paths.has(p)||names.has(item.name.toLowerCase()))add(owner,'inventory','方法名称或入口重复');paths.add(p);names.add(item.name.toLowerCase());if(!p.startsWith(owner+(kind==='skill'?'/skills/':'/workflows/')))add(owner,'ownership','方法不属于当前对象')}
    for(const p of actual)if(!paths.has(p))add(p,'inventory','方法入口未登记');for(const p of paths)if(!actual.includes(p))add(p,'inventory','清单不是有效方法入口');
  }
  private body(id:string,d:any,text:string,add:(p:string,c:string,m:string)=>void){
    const p=id+'/module.md';const sections=moduleSections;const seen:string[]=[];const content=new Map<string,string[]>();let section='',fence='',language='',block:string[]=[];const diagrams:{section:string;text:string}[]=[];let titles=0;
    for(const line of text.split(/\r?\n/)){
      if(fence){if(new RegExp('^\\s*'+fence[0]+'{'+fence.length+',}\\s*$').test(line)){if(language==='mermaid')diagrams.push({section,text:block.join('\n')});fence='';block=[]}else block.push(line);continue}
      const opening=line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);if(opening){fence=opening[1];language=opening[2].trim().toLowerCase();continue}
      if(/^#\s+/.test(line)){if(++titles>1||section)add(p,'sections','一级标题只能在正文前出现一次');continue}
      const h=line.match(/^##\s+(.+?)\s*#*\s*$/);if(h){section=h[1];seen.push(section);content.set(section,[]);continue}
      if(/^#{3,6}\s/.test(line)){const label=line.replace(/^#{3,6}\s+/,'').trim().replaceAll('`','');if(section!==sections[1]||!['子模块','Source 路径与维护说明',...d.sources.map((s:any)=>s.location)].includes(label))add(p,'sections',`不允许额外章节：${label}`)}
      if(line.trim()&&section)content.get(section)?.push(line);
    }
    if(fence)add(p,'fence','代码块未闭合');
    const wrongSections=JSON.stringify(seen)!==JSON.stringify(sections);
    const empty=sections.filter(s=>!content.get(s)?.length);
    const wrongDiagram=diagrams.length!==1||diagrams[0]?.section!==sections[2]||!/^\s*classDiagram\s+\S/.test(diagrams[0]?.text||'');
    if(wrongSections)add(p,'sections','二级标题必须按顺序逐字匹配，不加序号：\n'+sections.map(s=>'## '+s).join('\n'));
    for(const s of empty)add(p,'empty',`章节不能为空：## ${s}`);
    if(wrongDiagram)add(p,'diagram',`“## ${sections[2]}”须包含唯一非空 Mermaid classDiagram`);
    if(wrongSections||empty.length||wrongDiagram)add(p,'module_template','可复制的结构模板（须按实际业务填写后重新预览）：\n'+moduleBodyTemplate(d.sources.map((s:any)=>s.location)));
    if(/^\s*(?:#{1,6}\s+|[-*]\s+)?(?:id|sources|children|summary)\s*[:：=]/im.test(text))add(p,'duplicate_fields','正文不得重复维护索引字段');
    if(d.sources.length){const diagram=diagrams[0]?.text||'';if(!diagram.includes('class CbimDirectContent["直属内容（虚拟子模块）"]')||!diagram.includes('<<virtual>> CbimDirectContent'))add(p,'virtual','有直属内容时应使用规定的虚拟子模块节点')}
  }
}
