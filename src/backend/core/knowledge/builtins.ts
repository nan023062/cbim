/**
 * 作用定位：Builtins：白名单发布内置 Skill、规范和 Schema，包括团队/业务架构治理及只需简述、补充自愿的反馈流程。
 * 设计原因：只允许白名单资料 ID，返回正文、版本和引用；读取反馈 Skill 不会创建 GitHub Issue，也不扩大文件或网络权限。
 * 资源边界：运行规范随 design/ 打包；docs/ 只保留概念设计，不再作为内置资料的读取来源。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {fail} from '../foundation/errors';
import {hash} from '../foundation/serialization';

/** 产品内置流程清单；知识工具为每项注册只读 cbim_skill_* 别名，正文随应用资源打包。 */
export const builtinSkills=[
  {id:'bug-feedback',title:'BUG 反馈',description:'一句问题即可反馈 CBIM 缺陷，复现步骤、结果和环境自愿补充，不强制追问'},
  {id:'feature-wish',title:'需求许愿',description:'一句愿望即可提交 CBIM 需求，使用场景、困难和例子自愿补充，不强制追问'},
  {id:'knowledge-query',title:'知识查询',description:'定位权威知识、核实证据并回答，默认只读'},
  {id:'business-execution',title:'需求实现',description:'定位模块和 Agent，组织实现、验证与交付'},
  {id:'knowledge-governance',title:'知识治理',description:'检查事实、结构和引用，在授权内通过内部知识工具预览、提交和复核'},
  {id:'architecture-governance',title:'架构治理',description:'模式观察、架构评估、人工决定与渐进演进'},
  {id:'team-architecture-governance',title:'团队架构治理',description:'核实团队职责、能力与继承 Skill，在当前权限内预览、提交和复核团队知识'},
  {id:'business-architecture-governance',title:'业务架构治理',description:'按真实模块、代码和单向依赖渐进治理，校验知识结构并保留业务验收边界'},
  {id:'create-agent-skill',title:'创建 Agent/Team Skill',description:'为已有组织节点创建专业 Skill，维护清单并检查继承'},
  {id:'create-workflow',title:'创建模块 Workflow',description:'为已有模块创建独立流程并维护本模块清单'},
  {id:'core-check',title:'Core 检查',description:'仅在用户明确要求时检查分层、文档职责与继承'},
];
const entries=[
  ...builtinSkills.filter(s=>s.id!=='knowledge-governance').map(s=>[s.id,'skill',s.title,`design/runtime/${s.id}.md`]),
  ['knowledge-governance','skill','知识治理','design/runtime/knowledge-governance.md'],
  ['common-rules','standard','CBIM 内部执行与治理通用规范','design/runtime/common-rules.md'],
  ['module-spec','standard','Module 定义与维护规范','design/business/module-spec.md'],
  ['agent-spec','standard','Agent 定义与维护规范','design/capability/agent-spec.md'],
  ['architecture-spec','standard','架构评估与认知交付规范','design/task/architecture-spec.md'],
  ['task-baseline','standard','任务知识基线与恢复','design/task/task-baseline.md'],
  ['task-spec','standard','Task 定义','design/task/task-spec.md'],
  ['task-loop','standard','Task Loop','design/task/task-loop.md'],
  ['base-task','standard','Task 基础抽象','design/task/base-task.md'],
  ['shared-skills-workflows','standard','团队 Skill 与模块 Workflow 结构','design/runtime/shared-skills-workflows.md'],
  ['module-schema','schema','Module Schema','design/business/module.schema.json'],
  ['agent-schema','schema','Agent Schema','design/capability/agent.schema.json'],
  ['team-skills-schema','schema','Team Skill Schema','design/capability/team-skills.schema.json'],
  ['connector-schema','schema','连接器 Schema','design/connector/registry.schema.json'],
].map(([id,kind,title,source])=>({id,kind,title,source}));
const contract='内置资料只读，版本由内容 SHA-256 标识。查询以内部知识服务当前返回值为准；Agent 的原生工具禁止直接读写 .cbim；全部知识 CRUD 由受授权的内部工具执行，使用 cbim_object_preview/cbim_object_commit 或受控知识事务接口。派生注册表由 CBIM 维护。旧 Python 规则工具不是入口。Skill 工具返回流程，不会替 Agent 执行任务；结构校验不能替代语义与人工判断。';

export class Builtins {
  constructor(private designRoot:string){}
  private async document(entry:typeof entries[number]){
    // Only application-owned manifest entries can select a file, never caller paths.
    const root=path.resolve(this.designRoot,'..'),file=path.resolve(root,entry.source);
    const real=await fs.realpath(file),relative=path.relative(await fs.realpath(root),real);
    if(relative.startsWith('..')||path.isAbsolute(relative))fail('BUILTIN_PATH','内置资料越出安装目录');
    if((await fs.stat(real)).size>2*1024*1024)fail('BUILTIN_SIZE','内置资料超过大小限制');
    const text=await fs.readFile(real,'utf8');return {...entry,version:hash(text),text,readOnly:true};
  }
  /** 返回允许读取的全部内置资源及内容身份，不安装 Skill 或启动其流程。 */
  async catalog(){
    const items=await Promise.all(entries.map(async entry=>{const {text,...metadata}=await this.document(entry);return metadata}));
    return {entryId:'knowledge-governance',contract,revision:hash(JSON.stringify(items)),items};
  }
  /** 只读白名单正文；可核对原版本，不把读取成功解释成反馈提交或业务执行成功。 */
  async read(id:string,expectedVersion?:string){
    const entry=entries.find(e=>e.id===id);if(!entry)fail('BUILTIN_NOT_FOUND','未知内置资料 ID，请先调用 cbim_builtin_catalog');
    const result=await this.document(entry);
    if(expectedVersion&&expectedVersion!==result.version)fail('BUILTIN_VERSION_CHANGED','内置资料版本已变化，请重新查询清单并核对');
    const prose=result.text.replace(/(`{3,}|~{3,})[^\n]*\n[\s\S]*?\1/g,'');
    const links=[...prose.matchAll(/\]\(<?([^\s)>]+)>?(?:\s+"[^"]*")?\)/g),...prose.matchAll(/^\s*\[[^\]]+\]:\s*<?([^\s>]+)>?/gm)];
    const references=[...new Set(links.map(m=>m[1]))].map(reference=>{
      const [target,anchor]=reference.split('#');
      const found=target.startsWith('builtin:')?entries.find(e=>e.id===target.slice(8)):entries.find(e=>e.source===path.posix.normalize(path.posix.join(path.posix.dirname(entry.source),target)));
      return {reference,anchor,id:found?.id,status:found?'available':reference.startsWith('#')?'same_document':/^https?:/.test(reference)?'external':'unavailable'};
    });
    return {...result,contract,references};
  }
}
