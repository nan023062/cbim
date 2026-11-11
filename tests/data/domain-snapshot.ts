import {hash,json} from '../../src/backend/core/foundation/serialization';
import type {KnowledgeFile,Snapshot,ModuleNode} from '../../src/backend/core/knowledge/types';
import {moduleFiles,summary} from './knowledge';

/** 固定“已校验快照”输入，只用于读取模型；不代替 Rules 校验、知识事务或真实集成夹具。 */
export function domainSnapshot(){
  const agentId='.cbim/team/dev',moduleId='.cbim/workspace/game',child=moduleId+'/child';
  const shared='.cbim/team/skills/review',own=agentId+'/skills/coding',workflowId=moduleId+'/workflows/build';
  const files:KnowledgeFile[]=[...moduleFiles('game',[child]),...moduleFiles('game/child')];
  const add=(path:string,text:string)=>files.push({path,text,hash:hash(text)});
  const module=files.find(file=>file.path===moduleId+'/module.json')!;
  module.text=json({...JSON.parse(module.text),workflows:[{name:'构建验证',purpose:'验证',reference:'workflows/build/workflow.md'}]});
  module.hash=hash(module.text);
  add(agentId+'/agent.json',json({name:'开发者',summary,authors:[],capabilities:['实现'],connectors:[],work_principles:'principles.md'}));
  add(agentId+'/principles.md','# 原则\n验证实际结果。');
  add(own+'/SKILL.md','# 专业实现规则');
  add(shared+'/SKILL.md','# 团队校验规则');
  add(workflowId+'/workflow.md','# 工作流\n先理解目标，再验证并记录证据。');
  const nodes=Object.fromEntries([moduleId,child].map(id=>[id,JSON.parse(files.find(file=>file.path===id+'/module.json')!.text) as ModuleNode]));
  const indexes={
    '.cbim/team/registry.json':json({groups:[{id:'.cbim/team',agents:[{id:agentId,summary}]}]}),
    '.cbim/workspace/registry.json':json({modules:[moduleId,child].map(id=>({id,summary}))}),
  };
  const snapshot:Snapshot={workspaceId:'domain-workspace',instanceId:'00000000-0000-4000-8000-000000000001',revision:'fixed-domain-revision',files,validation:{
    issues:[],indexes,tree:{nodes,roots:[moduleId]},structural:true,architecture:'review-required',business:'not-run',
    skills:{[agentId]:{chain:['.cbim/team',agentId],entries:[
      {name:'coding',purpose:'实现',reference:own+'/SKILL.md',owner:agentId,scope:'own'},
      {name:'review',purpose:'验证',reference:shared+'/SKILL.md',owner:'.cbim/team',scope:'inherited'},
    ]}},
  }};
  return {snapshot,agentId,moduleId,child,shared,own,workflowId};
}
