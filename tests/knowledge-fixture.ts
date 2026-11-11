import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Rules,revision} from '../src/backend/core/knowledge/knowledge';
import {hash,json} from '../src/backend/core/foundation/serialization';
import type {KnowledgeFile,Snapshot} from '../src/backend/core/knowledge/types';
import {moduleFiles,summary} from './knowledge-data';

export const teamIds={
  agent:'.cbim/team/dev',module:'.cbim/workspace/game',child:'.cbim/workspace/game/child',
  own:'.cbim/team/dev/skills/coding',shared:'.cbim/team/skills/review',
  workflow:'.cbim/workspace/game/workflows/build',
};

const file=(path:string,value:unknown):KnowledgeFile=>{
  const text=typeof value==='string'?value:json(value);
  return {path,text,hash:hash(text)};
};

/** 使用真实规则生成校验快照；只需 Schema 和临时源目录，不创建应用、锁、账本或模型。 */
export async function knowledgeFixture(){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-knowledge-'));
  const cleanup=async()=>{
    const target=path.resolve(root);
    if(path.dirname(target)!==path.resolve(os.tmpdir())||!path.basename(target).startsWith('cbim-knowledge-')){
      throw Error('Refusing to remove paths outside this test directory');
    }
    await fs.rm(target,{recursive:true,force:true});
  };
  try{
    const rules=new Rules(path.resolve('design'));
    await rules.init();
    const base=[file('.cbim/connectors/registry.json',{connectors:[]}),file('.cbim/team/skills.json',{skills:[]})];
    const snapshot=async(files:KnowledgeFile[]=base):Promise<Snapshot>=>({
      workspaceId:'workspace',instanceId:'instance',revision:revision(files),files,
      validation:await rules.validate(root,files),
    });
    return {root,rules,base,snapshot,cleanup};
  }catch(error){await cleanup();throw error}
}

/** 有真实父子模块、团队继承 Skill 和本模块 Workflow 的领域样本。 */
export function teamKnowledgeFiles():KnowledgeFile[]{
  const modules=moduleFiles('game',[teamIds.child]);
  const definition=JSON.parse(modules[0].text);
  definition.workflows=[{name:'构建验证',reference:'workflows/build/workflow.md'}];
  modules[0]=file(modules[0].path,definition);
  return [
    file('.cbim/connectors/registry.json',{connectors:[]}),
    file('.cbim/team/skills.json',{skills:[{name:'review',purpose:'验证',reference:'skills/review/SKILL.md'}]}),
    file(teamIds.shared+'/SKILL.md','# 团队校验规则'),
    file(teamIds.agent+'/agent.json',{
      name:'开发者',summary,authors:[],capabilities:['实现'],limitations:[],connectors:[],
      work_principles:'principles.md',skills:[{name:'coding',purpose:'实现',reference:'skills/coding/SKILL.md'}],
    }),
    file(teamIds.agent+'/principles.md','# 原则\n验证实际结果。'),
    file(teamIds.own+'/SKILL.md','# 专业实现规则'),
    ...modules,...moduleFiles('game/child'),
    file(teamIds.workflow+'/workflow.md','# 工作流\n先理解目标，再验证并记录证据。'),
  ];
}
