/**
 * 作用定位：团队：Team/小组/Agent、真人花名册与 Agent 自身和祖先 Skill的核心封装。
 * 设计原因：在同一校验快照上提供领域语义，不依赖工作区进程或桌面页面。
 */
import path from 'node:path';
import {context,data,content} from '../knowledge/snapshot';
import {parseJson} from '../foundation/json';
import {fail} from '../foundation/errors';
import type {Snapshot} from '../knowledge/types';
/** 实例固定绑定一个快照；刷新知识后由调用方创建新的领域视图。 */
export class Team {
  constructor(private snapshot:Snapshot){}
  async agents(query=''){
    const s=this.snapshot,index=parseJson(s.validation!.indexes['.cbim/team/registry.json']);
    const people=data(s,'.cbim/team/people.json').people;
    return {...context(s),teamRootId:'.cbim/team',groups:index.groups.map((g:any)=>({...g,agents:g.agents.filter((a:any)=>!query||`${a.id} ${a.summary}`.toLowerCase().includes(query.toLowerCase())).map((a:any)=>{const d=data(s,a.id+'/agent.json');return {...a,name:d.name,authors:d.authors,authorPeople:people.filter((p:any)=>d.authors.includes(p.id))}})})),indexSource:'current-definitions',persistedIndexMatches:s.files.find(f=>f.path==='.cbim/team/registry.json')?.text===s.validation!.indexes['.cbim/team/registry.json']};
  }
  async people(query=''){
    const s=this.snapshot,people=data(s,'.cbim/team/people.json').people;
    if(!Array.isArray(people))fail('INVALID_DEFINITION','人员花名册格式错误');
    return {...context(s),people:people.filter((p:any)=>!query||JSON.stringify(p).toLowerCase().includes(query.toLowerCase()))};
  }
  async agent(id:string){
    const s=this.snapshot;
    if(!Object.hasOwn(s.validation!.skills||{},id))fail('OBJECT_NOT_FOUND','Agent 不存在或定义未通过校验，请先查询团队注册表与问题清单');
    const definition=data(s,id+'/agent.json'),effective=s.validation!.skills![id];
    const conflicts=s.validation!.issues.filter(i=>i.severity==='error'&&i.code==='skill_conflict'&&i.path===id+'/agent.json');
    return {...context(s),id,definition,definitionFile:s.files.find(f=>f.path===id+'/agent.json'),principles:content(s,id,definition.work_principles),skillChain:effective.chain,skillConflicts:conflicts,skills:effective.entries.map(e=>({...e,id:path.posix.dirname(e.reference),inherited:e.owner!==id,content:content(s,e.owner,path.posix.relative(e.owner,e.reference))})),skillSelectionValid:conflicts.length===0};
  }
}
