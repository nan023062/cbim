/** 将商城模板转换为项目节点；差异中的键只在指定项目实例内生效。 */
import {z} from 'zod';
import {agentConfigurationSchema} from './agent-configuration';
import {businessDefinitionSchema,type BusinessSnapshot} from './business-contract';
import {type OrganizationNode} from './organization-contract';
import type {OrganizationDirectory} from './organization-directory';
import type {BusinessDirectory} from './business-directory';
import {type MarketSource} from './market-source';

type Kind='talent'|'business';
type Node=OrganizationNode|BusinessSnapshot['nodes'][number];
type Origin={id:string;version:string;sha256:string};
const key=z.string().regex(/^[A-Za-z0-9_-]{1,80}$/);
const keys={key,parent:key.nullable()};
const skill= z.object({id:z.string().min(1).max(100),name:z.string().min(1).max(100),content:z.string().min(1).max(32000)}).strict();
const talent=z.object({...keys,kind:z.enum(['team','agent']),name:z.string().trim().min(1).max(160),position:z.string().max(4000),skills:z.array(skill).max(32).default([])}).strict();
const business=businessDefinitionSchema.omit({parentId:true}).extend(keys).strict();
type Definition=z.infer<typeof talent>|z.infer<typeof business>;
export type TemplateChange={id:string;label:string;before:string;after:string};
export type TemplatePreview={revision:number;instances:{id:string;name:string;version:string}[];changes:TemplateChange[]};
export type TemplateChoice={instance:string;revision:number;fields:string[]};
function definitions(kind:Kind,raw:unknown):Definition[]{
  let input:unknown[];
  if(raw&&typeof raw==='object'&&'nodes' in raw)input=z.object({nodes:z.array(z.unknown()).min(1).max(500)}).strict().parse(raw).nodes;
  else{const single=z.object({parentId:z.null().optional()}).passthrough().parse(raw);delete single.parentId;input=[{...single,key:'root',parent:null}]}
  const nodes=input.map(value=>kind==='talent'?talent.parse(value):business.parse(value));
  const byKey=new Map(nodes.map(n=>[n.key,n]));
  if(byKey.size!==nodes.length||nodes.filter(n=>n.parent===null).length!==1)throw Error('模板需要唯一根节点和不重复的节点键');
  for(const node of nodes){
    if('skills' in node){if(node.kind==='team'&&node.skills.length)throw Error('技能仅可用于岗位');agentConfigurationSchema.parse({skills:node.skills})}
    let p=node.parent;const seen=new Set([node.key]);
    while(p!==null){const parent=byKey.get(p);if(!parent||seen.has(p)||seen.size>=64||('kind' in parent&&parent.kind!=='team'))throw Error('模板归属无效');seen.add(p);p=parent.parent;}
  }
  return nodes;
}
function nodeFields(node:Node):Record<string,unknown>{
  if('kind' in node)return {name:node.name,position:node.position,...Object.fromEntries((node.configuration?.skills??[]).map(s=>['skill:'+s.id,s]))};
  return {name:node.name,summary:node.summary,sources:node.sources,virtual:node.virtual};
}
function display(value:unknown){return value===undefined?'（无）':typeof value==='string'?value:JSON.stringify(value)}
export async function marketTemplate(projects:{settings:{organization:OrganizationDirectory};businessDirectory:BusinessDirectory},project:string,kind:Kind,origin:Origin,raw:unknown,mode:'import'|'preview'|'merge',choice?:TemplateChoice):Promise<TemplatePreview>{
  if(mode==='import'&&choice)throw Error('新导入必须创建独立实例');
  const defs=definitions(kind,raw);
  const directory=kind==='talent'?projects.settings.organization:projects.businessDirectory;
  const snapshot=await directory.Read(project);
  const all:Node[]=snapshot.nodes;
  const instances=new Map<string,{id:string;name:string;version:string}>();
  for(const n of all)if(n.market?.resource===origin.id){
    const source=n.market;if(!instances.has(source.instance)||!all.some(x=>x.id===n.parentId&&x.market?.instance===source.instance))instances.set(source.instance,{id:source.instance,name:n.name,version:source.version});
  }
  if(mode==='preview'&&!choice)return {revision:snapshot.revision,instances:[...instances.values()],changes:[]};
  const instance=choice?.instance??crypto.randomUUID();
  if(mode!=='import'&&!instances.has(instance))throw Error('模板实例不属于该项目和资源');
  if(mode==='merge'&&choice?.revision!==snapshot.revision)throw Error('项目已更改，请重新预览差异');
  const local=new Map(all.filter(n=>n.market?.instance===instance&&n.market.resource===origin.id).map(n=>[n.market!.key,n]));
  const ids=new Map(defs.map(n=>[n.key,local.get(n.key)?.id??(kind==='talent'?'org:':'business:')+crypto.randomUUID()]));
  const selected=new Set(choice?.fields),changes:TemplateChange[]=[],mutations:((nodes:Node[])=>void)[]=[];
  function offer(key:string,field:string,before:unknown,after:unknown,apply:(nodes:Node[])=>void){
    if(JSON.stringify(before)===JSON.stringify(after))return;
    const id=JSON.stringify([key,field]);changes.push({id,label:key+' · '+field,before:display(before),after:display(after)});
    if(mode==='import'||selected.has(id))mutations.push(apply);
  }
  for(const d of defs){
    const source:MarketSource={resource:origin.id,version:origin.version,digest:origin.sha256,key:d.key,instance};
    const base={id:ids.get(d.key)!,name:d.name,parentId:d.parent===null?null:ids.get(d.parent)!,market:source};
    const next:Node='kind' in d?{...base,kind:d.kind,position:d.position,...(d.kind==='agent'?{configuration:{skills:d.skills,connectorIds:[]}}:{})}:{...base,summary:d.summary,sources:d.sources,virtual:d.virtual};
    const previous=local.get(d.key);
    if(!previous){
      if(mode==='import'&&d.parent===null){let seq=1;while(all.some(n=>n.parentId===null&&n.name.toLowerCase()===next.name.toLowerCase())){const suffix=' ('+(++seq)+')';next.name=d.name.slice(0,160-suffix.length)+suffix;}}
      offer(d.key,'新增节点',undefined,nodeFields(next),nodes=>{nodes.push(next)});continue;
    }
    if('kind' in previous&&'kind' in next&&previous.kind!==next.kind)throw Error('已有岗位类型发生变化，请作为新实例导入');
    const before=nodeFields(previous),after=nodeFields(next);
    const oldParent=all.find(n=>n.id===previous.parentId);
    offer(d.key,'父节点',oldParent?.market?.instance===instance?oldParent.market.key:previous.parentId,d.parent,nodes=>{nodes.find(n=>n.id===previous.id)!.parentId=next.parentId});
    for(const field of new Set([...Object.keys(before),...Object.keys(after)])){
      offer(d.key,field,before[field],after[field],nodes=>{
        const target=nodes.find(n=>n.id===previous.id)!;
        if(field.startsWith('skill:')&&'kind' in target){
          const config=target.configuration??{skills:[],connectorIds:[]};
          config.skills=config.skills.filter(s=>s.id!==field.slice(6));
          if(after[field])config.skills.push(skill.parse(after[field]));
          target.configuration=agentConfigurationSchema.parse(config);
          target.market!.configurationRevision=(target.market!.configurationRevision??0)+1;
        }else Object.assign(target,{[field]:after[field]});
      });
    }
  }
  for(const [k,n] of local)if(!ids.has(k))offer(k,'移除节点',n.name,undefined,nodes=>{const i=nodes.findIndex(v=>v.id===n.id);if(i>=0)nodes.splice(i,1)});
  if(mode!=='preview'){
    if(mode==='merge'&&(!selected.size||[...selected].some(id=>!changes.some(c=>c.id===id))))throw Error('请选择当前差异中的变更');
    await directory.EditMarketNodes(project,snapshot.revision,(nodes:Node[])=>{
      for(const mutate of mutations)mutate(nodes);
      for(const n of nodes)if(n.market?.instance===instance){n.market.version=origin.version;n.market.digest=origin.sha256}
    });
  }
  return {revision:snapshot.revision,instances:[...instances.values()],changes};
}
