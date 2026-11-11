import {it,expect} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './helpers';
import {moduleFiles,summary} from './data/knowledge';
import {json,hash} from '../src/backend/core/foundation/serialization';
import {parseJson} from '../src/backend/core/knowledge/knowledge';
import {moduleSections,moduleBodyTemplate} from '../src/backend/core/workspace/module-outline';

it('错误章节直接返回精确标题与可复制模板，空模块和有源模块的模板均可通过结构校验',async()=>{
  const f=await fixture();try{
    const e=await f.app.catalog.add(f.a),w=await f.app.open(e.id),base=(await w.read()).files;
    for(const sources of [[],[{location:'src',scope:'棋盘实现'}]]){
      if(sources.length)await fs.mkdir(path.join(f.a,'src'),{recursive:true});
      const files=moduleFiles('chess',[],sources);
      files[1].text=files[1].text.replace(/^## /gm,'## 1. ');files[1].hash=hash(files[1].text);
      const report=await f.app.rules.validate(f.a,[...base,...files]);
      expect(report.structural).toBe(false);
      const message=report.issues.find(i=>i.code==='sections')!.message;
      for(const heading of moduleSections)expect(message).toContain('## '+heading);
      expect(report.issues.find(i=>i.code==='module_template')!.message).toContain(moduleBodyTemplate(sources.map(s=>s.location)));
      files[1].text=moduleBodyTemplate(sources.map(s=>s.location));files[1].hash=hash(files[1].text);
      const repaired=await f.app.rules.validate(f.a,[...base,...files]);expect(repaired.issues.filter(i=>i.severity==='error')).toEqual([]);
    }
  }finally{await f.cleanup()}
});
it('JSON 重复字段、模块章节、source 文件与包含关系',async()=>{const f=await fixture();try{expect(()=>parseJson('{"a":1,"a":2}')).toThrow(/重复/);const e=await f.app.catalog.add(f.a),w=await f.app.open(e.id),base=(await w.read()).files;await fs.mkdir(path.join(f.a,'assets/child'),{recursive:true});await fs.writeFile(path.join(f.a,'file'),'data');
  let report=await f.app.rules.validate(f.a,[...base,...moduleFiles('game',[],[{location:'file',scope:'文件'}])]);expect(report.issues.some(i=>i.code==='source'&&i.severity==='error')).toBe(true);
  report=await f.app.rules.validate(f.a,[...base,...moduleFiles('game',['.cbim/workspace/game/child'],[{location:'assets',scope:'父范围'}]),...moduleFiles('game/child',[],[{location:'assets/child',scope:'子范围'}])]);expect(report.issues.filter(i=>i.code==='source_overlap')).toHaveLength(0);expect(report.structural).toBe(true);
  report=await f.app.rules.validate(f.a,[...base,...moduleFiles('game',[],[{location:'assets',scope:'父范围'}]),...moduleFiles('other',[],[{location:'assets/child',scope:'其他'}])]);expect(report.issues.some(i=>i.code==='source_overlap'&&i.severity==='warning')).toBe(true);
  const malformed=moduleFiles();malformed[1].text+="\n## 多余章节\n内容";report=await f.app.rules.validate(f.a,[...base,...malformed]);expect(report.structural).toBe(false);
}finally{await f.cleanup()}});
it('Team 祖先完整继承与名称冲突',async()=>{const f=await fixture();try{const e=await f.app.catalog.add(f.a),w=await f.app.open(e.id),base=(await w.read()).files.filter(x=>x.path!=='.cbim/team/skills.json');const entries:Record<string,string>={
  '.cbim/team/skills.json':json({skills:[{name:'review',purpose:'review',reference:'skills/review/SKILL.md'}]}),
  '.cbim/team/skills/review/SKILL.md':'# team method',
  '.cbim/team/dev/agent.json':json({name:'dev',summary,authors:[],capabilities:['开发'],limitations:[],work_principles:'principles.md',skills:[{name:'review',purpose:'review',reference:'skills/review/SKILL.md'}],connectors:[]}),
  '.cbim/team/dev/principles.md':'# principles','.cbim/team/dev/skills/review/SKILL.md':'# own method'};
  const report=await f.app.rules.validate(f.a,[...base,...Object.entries(entries).map(([p,text])=>({path:p,text,hash:hash(text)}))]);expect(report.issues.some(i=>i.code==='skill_conflict')).toBe(true);
}finally{await f.cleanup()}});
it('大模块树保持正式 children，不生成虚拟注册对象',async()=>{const f=await fixture();try{const e=await f.app.catalog.add(f.a),w=await f.app.open(e.id),base=(await w.read()).files;const children=Array.from({length:400},(_,i)=>'.cbim/workspace/root/node_'+i);const files=[...base,...moduleFiles('root',children),...children.flatMap(id=>moduleFiles(id.replace('.cbim/workspace/','')))];const result=await f.app.rules.validate(f.a,files);expect(Object.keys(result.tree.nodes)).toHaveLength(401);expect(result.tree.roots).toEqual(['.cbim/workspace/root']);expect(result.structural).toBe(true)}finally{await f.cleanup()}});
