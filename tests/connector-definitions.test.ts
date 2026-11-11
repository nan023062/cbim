import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import Ajv2020 from 'ajv/dist/2020';
import {describe,it,expect} from 'vitest';
import {connectorDefinitionSchema,connectorRegistrySchema,type ConnectorDefinition} from '../src/backend/core/connectors/definition';
import {ConnectorRegistry} from '../src/backend/core/connectors/registry';
import {
  repositoryConnectionPreviewInputSchema,repositoryConnectionPreviewSchema,repositoryConnectionCommitSchema,
  repositoryConnectionGrantInputSchema,repositoryConnectionRevokeInputSchema,repositoryConnectionGrantSchema,
  repositoryConnectionReceiptSchema,repositoryConnectionLookupSchema,repositoryConnectionListSchema,
  repositoryConnectionCheckInputSchema,repositoryConnectionCheckSchema,
} from '../src/backend/core/connectors/repository-connection';
import {fixture} from './helpers';
import {internalKnowledge} from './knowledge-tool-fixture';
import {seedTeam} from './team-fixture';

const repositoryId='0ab132f1-c678-409b-b0b6-99ee5a8d2263';
const plugin={id:'.cbim/connectors/docs',name:'文档桥',summary:'既有插件静态映射',plugin:{ghost_id:'docs',namespace:null}};
const repository={id:'.cbim/connectors/resources',name:'资源仓库',summary:'只保存可复用仓库身份',provider:'resource_repository_v1' as const,repository:{repositoryId}};
async function validator(){return new Ajv2020({allErrors:true,strict:false}).compile(JSON.parse(await fs.readFile('design/connector/registry.schema.json','utf8')))}

it('纯协议与实际知识 JSON Schema 同时接受原插件和资源仓库，不补造字段',async()=>{
  const validate=await validator();
  for(const connectors of [[],[plugin],[repository],[plugin,repository],[{...repository,repository:{repositoryId:repositoryId.toUpperCase()}}]]){
    const value={connectors};expect(validate(value),JSON.stringify(validate.errors)).toBe(true);
    expect(connectorRegistrySchema.parse(value)).toEqual(value);
  }
  expect(connectorDefinitionSchema.parse(plugin)).not.toHaveProperty('provider');
});

it('静态定义两套校验一致拒绝混合来源、凭据、地址、错误身份与未知字段',async()=>{
  const validate=await validator();
  const invalid=[
    {...plugin,provider:'cindy_plugin'}, {...repository,plugin:plugin.plugin}, {...plugin,repository:{repositoryId}},
    {...repository,provider:'unknown'}, {...repository,repository:{repositoryId,url:'http://localhost/'}},
    {...repository,repository:{repositoryId,token:'secret'}}, {...repository,authorization:'read'},
    {...repository,url:'http://localhost/'}, {...repository,repository:{repositoryId:'repo-1'}},
    {...repository,id:'.cbim/connectors/a/b'}, {...repository,id:'.cbim/connectors/../secret'},
    {...repository,id:'.cbim/connectors/资源'}, {...repository,id:'.cbim/connectors/'},
    {...repository,name:''}, {...repository,summary:''}, {...plugin,plugin:{ghost_id:'docs'}},
    {...plugin,plugin:{ghost_id:'docs',namespace:''}}, {...plugin,plugin:{ghost_id:'docs',namespace:null,enabled:true}},
  ];
  for(const entry of invalid){
    expect(connectorDefinitionSchema.safeParse(entry).success,JSON.stringify(entry)).toBe(false);
    expect(validate({connectors:[entry]}),JSON.stringify(entry)).toBe(false);
  }
  expect(connectorRegistrySchema.safeParse({connectors:[],granted:true}).success).toBe(false);
  expect(validate({connectors:[],granted:true})).toBe(false);
});

it('提供方身份不受 JSON 键序影响，不将不同仓库或插件混为一个目标',()=>{
  const other={...repository,id:'.cbim/connectors/other',repository:{repositoryId:randomUUID()}};
  const entries:ConnectorDefinition[]=[plugin,repository,other];
  const registry=new ConnectorRegistry(entries);expect(registry.duplicates()).toEqual([]);
  expect(registry.get(repository.id)).toEqual(repository);expect(registry.list('资源')).toEqual([repository,other]);
  expect(new ConnectorRegistry([...entries,{...plugin,id:'.cbim/connectors/plugin_copy',plugin:{namespace:null,ghost_id:'docs'}}]).duplicates()).toEqual(['.cbim/connectors/plugin_copy']);
  expect(new ConnectorRegistry([...entries,{...repository,id:'.cbim/connectors/repo_copy',repository:{repositoryId:repositoryId.toUpperCase()}}]).duplicates()).toEqual(['.cbim/connectors/repo_copy']);
  expect(new ConnectorRegistry([...entries,{...other,id:repository.id.toUpperCase(),repository:{repositoryId:randomUUID()}}]).duplicates()).toEqual([repository.id.toUpperCase()]);
  expect(new ConnectorRegistry([plugin,{...plugin,id:'.cbim/connectors/namespaced',plugin:{ghost_id:'docs',namespace:'null'}}]).duplicates()).toEqual([]);
});

it('真实知识事务接受两类静态定义与模块/角色引用，幂等提交不产生运行授权',async()=>{
  const f=await fixture();try{
    const entry=await f.app.dispatch('add',{path:f.a}),ws=f.app.workspace(entry.id),seed=await seedTeam(ws),{call}=internalKnowledge(ws);
    const snapshot=await ws.snapshot(),changes=[{path:'.cbim/connectors/registry.json',text:JSON.stringify({connectors:[plugin,repository]})}];
    for(const id of [seed.input.moduleId,seed.input.agentId]){
      const file=snapshot.files.find(file=>file.path===id+(id.startsWith('.cbim/team')?'/agent.json':'/module.json'))!;
      const definition=JSON.parse(file.text);definition.connectors=[plugin.id,repository.id];changes.push({path:file.path,text:JSON.stringify(definition)});
    }
    const input={revision:snapshot.revision,requestId:randomUUID(),changes};
    expect((await call('cbim_knowledge_preview',input)).validation.structural).toBe(true);
    const committed=await call('cbim_knowledge_commit',input,true);expect(committed.state).toBe('committed');
    expect(await call('cbim_knowledge_commit',input,true)).toEqual(committed);
    const current=await ws.snapshot();expect(current.validation?.structural).toBe(true);
    expect(JSON.parse(current.files.find(file=>file.path==='.cbim/connectors/registry.json')!.text)).toEqual({connectors:[plugin,repository]});
    const names=(await call('cbim_knowledge_tool_catalog')).tools.map((item:{name:string})=>item.name);expect(names.length).toBeGreaterThan(0);
    expect(names.some((name:string)=>name.startsWith('cbim_repository_'))).toBe(false);
    const remove={revision:current.revision,requestId:randomUUID(),changes:[{path:'.cbim/connectors/registry.json',text:JSON.stringify({connectors:[plugin]})}]};
    const rejected=await call('cbim_knowledge_preview',remove);expect(rejected.validation.structural).toBe(false);
    expect(rejected.validation.issues.some((issue:{code:string})=>issue.code==='connector')).toBe(true);
    await expect(call('cbim_knowledge_commit',remove,true)).rejects.toMatchObject({code:'VALIDATION'});
    expect((await ws.snapshot()).revision).toBe(current.revision);
  }finally{await f.cleanup()}
});

it('真实预览保留重复仓库诊断，结构错误不能提交也不会改写知识',async()=>{
  const f=await fixture();try{
    const entry=await f.app.dispatch('add',{path:f.a}),ws=f.app.workspace(entry.id),{call}=internalKnowledge(ws),snapshot=await ws.snapshot();
    for(const connectors of [[repository,{...repository,id:'.cbim/connectors/copy'}],[{...repository,repository:{repositoryId,token:'forbidden'}}]]){
      const input={revision:snapshot.revision,requestId:randomUUID(),changes:[{path:'.cbim/connectors/registry.json',text:JSON.stringify({connectors})}]};
      const preview=await call('cbim_knowledge_preview',input);expect(preview.validation.structural).toBe(false);
      expect(preview.validation.issues.some((issue:{code:string})=>['duplicate','schema'].includes(issue.code))).toBe(true);
      await expect(call('cbim_knowledge_commit',input,true)).rejects.toMatchObject({code:'VALIDATION'});
      expect((await ws.snapshot()).revision).toBe(snapshot.revision);
    }
  }finally{await f.cleanup()}
});

describe('桌面连接纯协议',()=>{
  const identity={workspaceId:'workspace',instanceId:'8ab132f1-c678-409b-b0b6-99ee5a8d2263'},definitionHash='a'.repeat(64),commandId='2ab132f1-c678-409b-b0b6-99ee5a8d2263',connectionId='3ab132f1-c678-409b-b0b6-99ee5a8d2263',time='2026-11-07T00:00:00.000Z';
  const grant={workspaceId:identity.workspaceId,connectorId:repository.id,repositoryId,definitionHash,revision:1,enabled:true,updatedAt:time};
  it('请求分别表达定义登记、授权与核验，拒绝调用方注入网络凭据和成功标记',()=>{
    const preview={...identity,revision:'knowledge',repositoryId,connectorId:repository.id,name:repository.name,summary:repository.summary};
    const approve={...identity,connectorId:repository.id,repositoryId,definitionHash,expectedGrantRevision:0,commandId};
    expect(repositoryConnectionPreviewInputSchema.parse(preview)).toEqual(preview);expect(repositoryConnectionGrantInputSchema.parse(approve)).toEqual(approve);
    for(const extra of [{token:'secret'},{url:'http://localhost/'},{readOnly:true},{authorized:true}]){
      expect(repositoryConnectionPreviewInputSchema.safeParse({...preview,...extra}).success).toBe(false);
      expect(repositoryConnectionGrantInputSchema.safeParse({...approve,...extra}).success).toBe(false);
    }
    expect(repositoryConnectionGrantInputSchema.safeParse({...approve,expectedGrantRevision:-1}).success).toBe(false);
    expect(repositoryConnectionGrantInputSchema.safeParse({...approve,expectedGrantRevision:Number.MAX_SAFE_INTEGER+1}).success).toBe(false);
    expect(repositoryConnectionRevokeInputSchema.safeParse({...identity,connectorId:repository.id,expectedGrantRevision:1,commandId}).success).toBe(true);
    expect(repositoryConnectionCheckInputSchema.safeParse({...identity,connectorId:repository.id,expectedGrantRevision:1,commandId}).success).toBe(false);
    expect(repositoryConnectionLookupSchema.safeParse({workspaceId:identity.workspaceId,commandId}).success).toBe(true);
  });
  it('真实回执形状不冒充授权或模型调用，HTTP 核验有界且无资源正文',()=>{
    const preview={identity,planId:commandId,revision:'knowledge',repositoryId,connectionId,definition:repository,definitionHash,changes:[],validation:{structural:true,issues:[],architecture:'review-required',business:'not-run'},diff:''};
    expect(repositoryConnectionPreviewSchema.parse(preview)).toEqual(preview);
    expect(repositoryConnectionCommitSchema.safeParse({identity,planId:commandId,connectorId:repository.id,repositoryId,definitionHash,knowledgeRevision:'next',state:'committed',changed:[]}).success).toBe(true);
    expect(repositoryConnectionGrantSchema.parse(grant)).toEqual(grant);
    const receipt={workspaceId:identity.workspaceId,connectorId:repository.id,commandId,action:'grant',grant};expect(repositoryConnectionReceiptSchema.parse(receipt)).toEqual(receipt);
    const list={identity,knowledgeRevision:'current',sharing:{repositoryId,connectionId},connections:[{connectorId:repository.id,name:repository.name,summary:repository.summary,provider:repository.provider,definitionHash,repositoryId,grantRevision:1,grant,status:'ready'}]};
    expect(repositoryConnectionListSchema.parse(list)).toEqual(list);
    const item={id:commandId,kind:'skill',name:'测试技能',summary:'摘要',updatedAt:time};
    const check={identity,connectorId:repository.id,repositoryId,definitionHash,grantRevision:1,connectionId,checkedAt:time,revision:'repo-revision',itemCount:1,items:[item],truncated:false,readOnly:true,transport:'http'};
    expect(repositoryConnectionCheckSchema.parse(check)).toEqual(check);
    expect(repositoryConnectionCheckSchema.safeParse({...check,items:[{...item,content:'private'}]}).success).toBe(false);
    expect(repositoryConnectionCheckSchema.safeParse({...check,itemCount:21,items:Array.from({length:21},()=>item)}).success).toBe(false);
    expect(repositoryConnectionCheckSchema.safeParse({...check,transport:'local_read'}).success).toBe(false);
    expect(repositoryConnectionCheckSchema.safeParse({...check,token:'secret'}).success).toBe(false);
  });
});
