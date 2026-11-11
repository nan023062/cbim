import {expect,it} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {knowledgeFileTree} from '../src/frontend/knowledge/knowledge-file-tree';
import {KnowledgeFileTree} from '../src/frontend/knowledge/KnowledgeFileTree';
import {KnowledgeFilePreview} from '../src/frontend/knowledge/KnowledgeFilePreview';
import {governanceWorkflow} from '../src/frontend/knowledge/GovernanceLaunch';
import type {Snapshot} from '../src/bridge/contracts/workspace';
const files=['.cbim/team/dev/agent.json','.cbim/team/dev/principles.md','.cbim/team/dev/skills/review/SKILL.md','.cbim/workspace/game/module.md','.cbim/team/../escape.md'].map(path=>({path,text:path.endsWith('.json')?'bad json':'# 实际正文',hash:'a'.repeat(64)}));
it('目录树只展示根内真实文件，保留方法目录与搜索父链，不把文件当业务模块',()=>{
 const tree=knowledgeFileTree(files,'.cbim/team');expect(tree.children.map(n=>n.name)).toEqual(['dev']);expect(tree.children[0].children[0].name).toBe('skills');expect(JSON.stringify(tree)).not.toContain('escape');
 const filtered=knowledgeFileTree(files,'.cbim/team','review');expect(filtered.children[0].children).toHaveLength(1);expect(filtered.children[0].children[0].children[0].name).toBe('review');
});
it('团队文件可预览编辑，坏 JSON 的原诊断可见；业务与团队治理入口指向不同真实流程',()=>{
 const snapshot={workspaceId:'workspace',instanceId:'instance',revision:'a'.repeat(64),files:files.slice(0,4),validation:{issues:[{path:files[0].path,code:'json',severity:'error',message:'JSON 格式错误'}]}} as Snapshot;
 const tree=renderToStaticMarkup(createElement(KnowledgeFileTree,{snapshot,root:'.cbim/team',label:'团队',onSelect:()=>{}}));expect(tree).toContain('principles.md');expect(tree).toContain('SKILL.md');expect(tree).toContain('折叠');
 const preview=renderToStaticMarkup(createElement(KnowledgeFilePreview,{snapshot,path:files[0].path}));expect(preview).toContain('编辑文件');expect(preview).toContain('JSON 格式错误');expect(preview).toContain('bad json');
 expect(governanceWorkflow('team').tool).toBe('cbim_skill_team_architecture_governance');expect(governanceWorkflow('business').tool).toBe('cbim_skill_business_architecture_governance');
});
it('名称在展开箭头前，行尾操作有独立可访问名且文件不获得目录动作',()=>{
 const snapshot={workspaceId:'workspace',instanceId:'instance',revision:'r',files:files.slice(0,4)} as Snapshot;
 const seen:string[]=[],html=renderToStaticMarkup(createElement(KnowledgeFileTree,{snapshot,root:'.cbim/team',label:'团队',onSelect:()=>{},actions:node=>{seen.push(node.path);return node.path.endsWith('/dev')?[{id:'edit-dev',label:'编辑 Agent',icon:'edit',onSelect:()=>{}}]:[]}}));
 const row=html.slice(html.indexOf('data-knowledge-path=".cbim/team/dev"'),html.indexOf('data-knowledge-path=".cbim/team/dev/skills"'));
 expect(row.indexOf('>dev</span>')).toBeLessThan(row.indexOf('aria-expanded='));expect(row.indexOf('aria-expanded=')).toBeLessThan(row.indexOf('knowledge-row-menu'));
 expect(row).toContain('aria-label="dev的操作"');expect(row).toContain('title="编辑 Agent"');expect(row).toContain('data-tree-action="edit-dev"');expect(row).not.toContain('>编辑 Agent<');expect(seen.every(value=>!value.endsWith('.json')&&!value.endsWith('.md'))).toBe(true);
});
