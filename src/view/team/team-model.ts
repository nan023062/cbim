/**
 * 作用定位：从工作区知识快照构建静态 Team、分组、Agent 与 Skill 视图模型。
 * 设计原因：树与详情共用归属/继承规则；主角色隐式承担未分配模块，不再提供默认执行者节点或岗位选项。
 * 节点只解析可核实的本机 runtime 引用，供新岗位预选；能力正文与运行中的模型快照保持分离。
 */
import {agentModelSelectionSchema,type AgentModelSelection} from '../../bridge/contracts/agent-settings';
import type {Snapshot} from '../../bridge/contracts/workspace';
import {teamGroupIds} from '../knowledge/static-owners';

export const TEAM_ROOT='.cbim/team';
export const MAIN_AGENT='cbim:main';
/** id 始终来自快照文件路径；内置主角色使用稳定应用身份，不对应可编辑文件。 */
export interface TeamNodeView {
  id:string;parentId?:string;kind:'team'|'group'|'agent'|'builtin';name:string;summary:string;
  runtime?:AgentModelSelection;
  capabilities:string[];limitations:string[];body:string;bodyAvailable:boolean;children:string[];
}
/** Skill 属于一个组织节点；可用性只表示快照中有正文，不代表授权执行。 */
export interface TeamSkillView {id:string;ownerId:string;name:string;purpose:string;reference:string;body:string;available:boolean}
export interface TeamModel {nodes:Record<string,TeamNodeView>;skills:TeamSkillView[];issues:string[]}
function record(value:unknown):Record<string,unknown>{return value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{}}
function text(value:unknown):string{return typeof value==='string'?value:''}
function strings(value:unknown):string[]{return Array.isArray(value)?value.filter((item):item is string=>typeof item==='string'):[]}
function parent(id:string):string{return id.slice(0,id.lastIndexOf('/'))}
function referencePath(owner:string,reference:string):string|undefined {
  if(!reference||reference.startsWith('/')||reference.includes('\\')||reference.split('/').some(part=>!part||part==='.'||part==='..'))return;
  return `${owner}/${reference}`;
}
/** 保留空 Team/分组；损坏的定义单独报告，不能静默伪造成可编辑 Agent。 */
export function buildTeamModel(snapshot:Snapshot|undefined,workspaceName:string):TeamModel {
  const nodes:Record<string,TeamNodeView>={},skills:TeamSkillView[]=[],issues:string[]=[];
  const files=new Map((snapshot?.files??[]).map(file=>[file.path,file.text]));
  const definitions=new Map<string,Record<string,unknown>>();
  function group(id:string){
    if(nodes[id]||!(id===TEAM_ROOT||id.startsWith(`${TEAM_ROOT}/`)))return;
    nodes[id]={id,parentId:id===TEAM_ROOT?undefined:parent(id),kind:id===TEAM_ROOT?'team':'group',name:id===TEAM_ROOT?workspaceName:id.split('/').at(-1)!,summary:'',capabilities:[],limitations:[],body:'',bodyAvailable:false,children:[]};
    if(id!==TEAM_ROOT)group(parent(id));
  }
  group(TEAM_ROOT);
  for(const [path,raw] of files){
    if(!path.startsWith(`${TEAM_ROOT}/`)||!path.endsWith('/agent.json'))continue;
    const id=path.slice(0,-'/agent.json'.length);
    if(id===TEAM_ROOT){issues.push(`Team 根不能作为 Agent 定义：${path}`);continue}
    try{
      const data=record(JSON.parse(raw));
      if(!text(data.name))throw new Error('missing name');
      definitions.set(id,data);
      const principles=referencePath(id,text(data.work_principles));
      nodes[id]={id,parentId:parent(id),kind:'agent',runtime:agentModelSelectionSchema.safeParse(data.runtime).success?agentModelSelectionSchema.parse(data.runtime):undefined,name:text(data.name),summary:text(data.summary),capabilities:strings(data.capabilities),limitations:strings(data.limitations),body:principles?files.get(principles)??'':'',bodyAvailable:!!principles&&files.has(principles),children:[]};
      group(parent(id));
    }catch{issues.push(`定义无法解析：${path}`)}
  }
  for(const [path,raw] of files){
    if(!path.startsWith(`${TEAM_ROOT}/`)||!path.endsWith('/skills.json'))continue;
    const owner=path.slice(0,-'/skills.json'.length);
    if(nodes[owner]?.kind==='agent')continue;
    group(owner);
    try{definitions.set(owner,record(JSON.parse(raw)))}catch{issues.push(`定义无法解析：${path}`)}
  }
  // 与编辑器/导入器使用同一同版本静态组清单，保留真实目录中的空组和只有辅助正文的组。
  if(snapshot)for(const id of teamGroupIds(snapshot))group(id);
  for(const [owner,data] of definitions){
    for(const value of Array.isArray(data.skills)?data.skills:[]){
      const entry=record(value),reference=text(entry.reference),path=referencePath(owner,reference);
      if(!path||!/^skills\/[^/]+\/SKILL\.md$/.test(reference)){issues.push(`Skill 引用不符合节点内路径约定：${owner} / ${reference}`);continue}
      skills.push({id:path.slice(0,-'/SKILL.md'.length),ownerId:owner,name:text(entry.name)||reference.split('/')[1],purpose:text(entry.purpose),reference,body:files.get(path)??'',available:files.has(path)});
    }
  }
  nodes[MAIN_AGENT]={id:MAIN_AGENT,parentId:TEAM_ROOT,kind:'builtin',name:'CBIM 主 Agent',summary:'负责直接实现、验证、团队调度和受控知识治理；模块未指定自定义 Agent 时由主 Agent 执行。角色由应用维护。',capabilities:[],limitations:[],body:'',bodyAvailable:false,children:[]};
  for(const node of Object.values(nodes)){if(node.parentId)nodes[node.parentId]?.children.push(node.id)}
  const priority=(id:string)=>id===MAIN_AGENT?0:1;
  for(const node of Object.values(nodes))node.children.sort((a,b)=>priority(a)-priority(b)||nodes[a].name.localeCompare(nodes[b].name));
  return {nodes,skills,issues};
}
/** 自有 Skill 优先展示，然后沿父链到 Team 根；继承项只能跳到所属节点维护。 */
export function availableTeamSkills(model:TeamModel,nodeId:string):Array<TeamSkillView&{inherited:boolean}> {
  const result:Array<TeamSkillView&{inherited:boolean}>=[],seen=new Set<string>();
  let owner=model.nodes[nodeId]?.kind==='builtin'?TEAM_ROOT:nodeId;
  while(owner&&!seen.has(owner)){
    seen.add(owner);
    result.push(...model.skills.filter(skill=>skill.ownerId===owner).map(skill=>({...skill,inherited:owner!==nodeId})));
    owner=model.nodes[owner]?.parentId??'';
  }
  return result;
}
/** 搜索保留祖先路径；组织树可排除内置角色，完整模型及 Skill 父链保持不变。 */
export function visibleTeamNodes(model:TeamModel,query:string,includeBuiltins=true):Set<string> {
  const needle=query.trim().toLocaleLowerCase(),visible=new Set<string>();
  for(const node of Object.values(model.nodes)){
    if(!includeBuiltins&&node.kind==='builtin')continue;
    const haystack=[node.id,node.name,node.summary,...node.capabilities,...node.limitations,...model.skills.filter(skill=>skill.ownerId===node.id).flatMap(skill=>[skill.name,skill.purpose])].join(' ').toLocaleLowerCase();
    if(needle&&!haystack.includes(needle))continue;
    let current:TeamNodeView|undefined=node;
    while(current&&!visible.has(current.id)){visible.add(current.id);current=current.parentId?model.nodes[current.parentId]:undefined}
  }
  return visible;
}
