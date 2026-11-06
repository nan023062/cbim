/** 作用定位：按实际源码生成目录清单与现状类图，并独立附加 CONTRACT.md 的设计契约与落地范围。
 * 设计原因：让未来接口与现状结构分开维护，避免重新生成类图时丢失契约；--check 同时检查两部分漂移。 */
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const scope={
 'src':'应用按前端视图层 frontend 与本机后端逻辑层 backend 分组，bridge 是连接两层的通信边界，不是第三个业务层。目录聚合中的 backend 与 bridge 双向箭头分别来自 main 消费契约、契约重导出 Core 公开类型，不代表文件循环。',
 'src/backend':'本机后端逻辑层：main 装配平台与服务，scheduler-engine 协调执行，core 提供领域与大脑能力。调度单向依赖 Core；后端不导入前端界面。',
 'src/bridge':'前后端通信边界：contracts 声明公开数据，preload 提供 Electron 安全桥。契约可重导出 Core 公开类型和纯函数，不暴露后端服务、凭据和存储实现。',
 'src/backend/core':'核心领域与通用执行契约。大脑、团队、业务模块、知识和工具各自维护语义；不导入 main、调度、IPC 或界面。',
 'src/backend/core/foundation':'少量跨领域基础：错误、序列化、严格 JSON、标识及路径端口。files.ts 是 Node 文件原语，不管理应用目录、事务或账户。',
 'src/backend/core/brain':'引擎无关的执行循环与事件契约。工具决策先落盘，完成或未知结果生成运行回执；审批后复核停止，恢复不自动重放未知操作。',
 'src/backend/core/brain/llm':'公开模型参数、能力元数据及运行快照端口。实际配置文件和加密凭据由 main/persistence/settings 持有。',
 'src/backend/core/brain/pi':'Pi 协议、临时桥与运行参数。一次性 gate 连接统一授权，指引明确业务与知识共用运行权限；保留图片、恢复及长度错误报告。工具结果写入会话前校验，协议错误保留错误码且不重放操作。',
 'src/backend/core/connectors':'链接器定义、查询与唯一身份检查；当前不执行外部插件。',
 'src/backend/core/knowledge':'知识快照、校验、领域查询和对象变更规划。物理事务通过 KnowledgeWorkspace 注入，预览缓存通过 ObjectStorage 注入。Team/Workspace 仅依赖本目录的只读快照辅助，不依赖查询门面或工具注册。',
 'src/backend/core/policy':'内部运行的统一授权：业务与知识写入共用 read/ask/execute，平台边界不可豁免；外部 MCP 保留独立凭据与写开关，不声称操作系统隔离。',
 'src/backend/core/tasks':'任务定义和待执行消息契约。区分 taskId 与 runId；当前不包含业务自动验收或 Workflow 状态机。',
 'src/backend/core/team':'Team、小组、Agent 和父链 Skill 的只读领域视图；通过版本固定的快照解析，不依赖工作区进程。',
 'src/backend/core/tools':'工具 Schema、版本、副作用、调用决策、结构化提问及回执；统一校验结果的 JSON 传输快照，拒绝缺失文本等无效内容。回执绑定运行身份与输入结果哈希；注册和发现不授予执行权限。',
 'src/backend/core/workspace':'领域工程、Module 与本模块 Workflow 的只读视图；与 main/workspace 的本机生命周期分开。',
 'src/bridge/contracts':'可序列化的 IPC 数据与公开展示契约。可以重导出 Core 类型及纯格式化函数，不暴露密钥或平台存储实现。',
 'src/backend/scheduler-engine':'工作区调度。装配团队上下文与模型工具，协调会话、运行、用户问题和队列；只依赖自身及 Core。',
 'src/backend/scheduler-engine/context':'准备并冻结明确选择的 Agent、模块、Skill 和 Workflow。直接调用领域查询，不经模型工具协议。',
 'src/backend/scheduler-engine/conversation':'主 Agent 指引、用户问题、任务内操作确认及消息队列。业务与知识共用本轮审批，停止和结束清理临时授权；队列按提交版本发布增量。',
 'src/backend/scheduler-engine/execution':'执行工厂与工作区运行管理器。存储、租约和平台访问策略由应用注入；管理历史、队列续接、启动与恢复。',
 'src/backend/scheduler-engine/tools':'把 Core 知识能力暴露为 cbim_ 工具。内置 Loop 与可选 MCP 复用参数、身份和领域检查；内部 Loop 使用单次 gate 授权，外部 MCP 仍核验写凭据与实例开关。返回结果须通过统一协议校验；维护任务 ID 与对话、成员派发任务区分，取消未知 ID 明确报错。',
 'src/backend/main':'Electron 入口与应用装配。管理工作区生命周期、模型存储、平台能力和调度实例，具体 action 在 ipc 中路由。',
 'src/backend/main/commands':'CLI 入口，复用应用和调度，不拥有第二套领域规则。',
 'src/backend/main/ipc':'应用 action 路由。调用显式携带工作区和任务身份，桌面发送方核验仍在 Electron 接入处执行。',
 'src/backend/main/platform':'本机路径、系统锁、凭据加密、命令终端及原生工具访问检查。路径策略不是操作系统沙箱。',
 'src/backend/main/persistence':'本机持久化适配：知识事务、运行日志、对话附件、模型配置。保留原数据路径与格式，目录调整不迁移用户数据。',
 'src/backend/main/persistence/knowledge':'正式知识文件读取、初始化、事务恢复和对象计划缓存。提交串行化，回滚不覆盖外部修改，清理仅删除空目录。',
 'src/backend/main/persistence/settings':'应用级供应商和模型配置存储。密钥经注入的系统加密端口保存，不在公开 IPC 返回。',
 'src/backend/main/persistence/tasks':'执行事件日志、存储端口实现及不可变附件快照。日志 fsync 后发布，读取时核对并汇总工具回执身份；图片独立保存并恢复为视觉输入。',
 'src/backend/main/integrations':'可选外部接入，隔离 MCP 传输与外部宿主兼容。内部 Loop 不依赖外部服务连接。',
 'src/backend/main/integrations/hosts':'外部宿主的 stdio 桥、配置、启动指引和保护 Hook。访问判断复用 platform/tool-guard，不参与内部大脑编排。',
 'src/backend/main/integrations/mcp':'可选 MCP 发布、发现、鉴权、调用日志及心跳。复用调度知识工具适配，不维护领域规则副本。',
 'src/backend/main/resources':'链接器、人才和业务模板共用的本地/远端资源仓库实现。资源定义不等于已连接的可执行工具。',
 'src/backend/main/workspace':'本机工作区登记与运行实例。持锁后打开、监听、协调关闭，知识事务委托 persistence/knowledge。',
 'src/bridge/preload':'固定 Electron IPC 桥；不向页面暴露 Node、凭据或任意磁盘 API。',
 'src/frontend':'React 桌面界面。只消费 contracts 和自身组件，不导入调度或主进程实现。',
 'src/frontend/automation':'工作区内部自动化展示；定时触发尚未实现。',
 'src/frontend/components':'通用展示组件，不持有领域服务与运行状态。',
 'src/frontend/conversation':'中央对话、输入、附件、队列与工具状态。权限说明覆盖业务文件与知识提交；队列以版本增量同步，不因空轮询替换列表引用。',
 'src/frontend/diagnostics':'MCP 健康、流量与调用日志的诊断展示，不把服务在线视为知识校验通过。',
 'src/frontend/knowledge':'知识问题、预览提交和维护工具界面；业务架构展示位于 workspace。',
 'src/frontend/resources':'三类共享资源的查看与编辑界面。仓库设置通过统一设置入口打开。',
 'src/frontend/settings':'模型及仓库配置界面，凭据仅提交主进程保存，账户仍按当前占位语义处理。',
 'src/frontend/shell':'工作区侧栏、会话选择、用户栏与右侧扩展页签；会话区与项目级视图区分开。',
 'src/frontend/tasks':'当前会话执行视图与维护任务展示，按工作区和任务身份过滤。',
 'src/frontend/team':'当前工作区团队架构及能力详情展示。',
 'src/frontend/workspace':'当前工作区业务模块架构展示；知识编辑仍委托 knowledge 的维护组件。',
};
const norm=p=>p.replaceAll('\\','/');
const walk=p=>fs.readdirSync(p,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(p+'/'+e.name):[p+'/'+e.name]);
const files=walk('src').filter(f=>/\.(tsx?|jsx?|mjs|cjs|css)$/.test(f));
const directories=[...new Set(files.flatMap(f=>{const a=[];let d=path.posix.dirname(f);while(d==='src'||d.startsWith('src/')){a.push(d);if(d==='src')break;d=path.posix.dirname(d)}return a}))].sort();
const text=new Map(files.map(f=>[f,fs.readFileSync(f,'utf8')]));
const ast=new Map(files.filter(f=>!f.endsWith('.css')).map(f=>[f,ts.createSourceFile(f,text.get(f),ts.ScriptTarget.Latest,true)]));
function imports(f){const s=ast.get(f);if(!s)return [];const out=[];const visit=n=>{if(ts.isStringLiteral(n)&&n.text.startsWith('.')){const p=n.parent;if(ts.isImportDeclaration(p)||ts.isExportDeclaration(p)||(ts.isLiteralTypeNode(p)&&ts.isImportTypeNode(p.parent))){const t=norm(path.normalize(path.join(path.dirname(f),n.text)));const resolved=[t,t+'.ts',t+'.tsx',t+'/index.ts'].find(x=>text.has(x));if(resolved)out.push(resolved)}}ts.forEachChild(n,visit)};visit(s);return [...new Set(out)]}
const deps=new Map(files.map(f=>[f,imports(f)]));
const id=s=>'N_'+s.replace(/[^a-zA-Z0-9_]/g,'_');
const link=(from,to)=>norm(path.relative(from,to));
const clean=s=>s.replace(/[<>"{}|\r\n]/g,' ').slice(0,95);
function role(f){return text.get(f).match(/作用定位：([^\r\n]+)/)?.[1]?.trim()||(f.endsWith('.css')?'对应界面的布局与视觉样式。':'源码入口，见文件正文。')}
function node(f,label=path.posix.basename(f),directory=false){return `class ${id(f)}["${clean(label)}"] {\n  <<${directory?'directory':f.endsWith('.tsx')?'component':f.endsWith('.css')?'stylesheet':'module'}>>\n}`}
function declarations(f){const a=ast.get(f);return a?a.statements.filter(n=>(ts.isClassDeclaration(n)||ts.isInterfaceDeclaration(n)||ts.isTypeAliasDeclaration(n))&&n.name):[]}
function members(n,a){
 if(!n.members)return [];
 const properties=n.members.filter(ts.isConstructorDeclaration).flatMap(c=>c.parameters.filter(p=>p.modifiers?.some(m=>[ts.SyntaxKind.PublicKeyword,ts.SyntaxKind.PrivateKeyword,ts.SyntaxKind.ProtectedKeyword,ts.SyntaxKind.ReadonlyKeyword].includes(m.kind))));
 return [...properties,...n.members.filter(m=>m.name&&!ts.isPrivateIdentifier(m.name))].slice(0,16).map(m=>{const name=m.name.getText(a);const privateMember=m.modifiers?.some(x=>x.kind===ts.SyntaxKind.PrivateKeyword);return `  ${privateMember?'-':'+'}${clean(name)}${ts.isMethodDeclaration(m)||ts.isMethodSignature(m)?'()':''}`});
}
function heritage(f,n,key,group,a){
 const lines=[];
 for(const h of n.heritageClauses||[])for(const t of h.types){
  const name=t.expression.getText(a),parent=group.find(x=>x.name.text===name);
  const target=parent?id(f+'_'+parent.name.text):id(f+'_external_'+name);
  if(!parent)lines.push(`class ${target}["${clean(name)} (外部契约)"] {\n  <<external>>\n}`);
  lines.push(`${target} <|${h.token===ts.SyntaxKind.ImplementsKeyword?'..':'--'} ${key}`);
 }
 return lines;
}
function diagram(lines){return '```mermaid\nclassDiagram\n'+lines.join('\n')+'\n```\n'}
let changed=[];
for(const d of directories){
 const own=files.filter(f=>path.posix.dirname(f)===d),children=directories.filter(c=>path.posix.dirname(c)===d);
 if(!scope[d])throw Error('需要先审视新目录职责：'+d);
 let out=`# ${d} 架构\n\n## 目录定位\n\n${scope[d]}\n\n本文描述当前实现。通过分析目录边界后维护的 [源码架构脚本](${link(d,'scripts/source-architecture.mjs')}) 同步清单和声明；代码变更时仍须核对职责、关键成员与关系。\n\n## 代码清单\n\n`;
 out+=own.length?'| 文件 | 当前职责 |\n| --- | --- |\n'+own.map(f=>`| [${path.posix.basename(f)}](${path.posix.basename(f)}) | ${role(f).replaceAll('|','／')} |`).join('\n')+'\n':'本层无直接代码文件。\n';
 out+='\n## 架构类图\n\n';
 if(children.length){
  const boundaries=[...children,...own];
  const owner=f=>own.includes(f)?f:children.find(c=>f.startsWith(c+'/'));
  const edges=new Set();for(const f of files.filter(f=>f.startsWith(d+'/'))){const a=owner(f);for(const dep of deps.get(f)||[]){const b=owner(dep);if(a&&b&&a!==b)edges.add(`${id(a)} ..> ${id(b)} : 导入依赖`)}}
  // 分组展示较大的目录边界，跨组关系另列，避免缩成不可读的大图。
  for(let i=0;i<boundaries.length;i+=6){const group=boundaries.slice(i,i+6),ids=new Set(group.map(id));out+=diagram([...group.map(f=>node(f,path.posix.basename(f)+(children.includes(f)?'/':''),children.includes(f))),...[...edges].filter(e=>{const [a,,b]=e.split(' ');return ids.has(a)&&ids.has(b)})])+'\n'}
  out+='各图中的同名节点表示同一目录边界；跨组及完整直接依赖如下（无边不代表继承）：\n\n';
  out+=[...edges].map(e=>{const [a,,b]=e.split(' ');const f=boundaries.find(f=>id(f)===a),t=boundaries.find(f=>id(f)===b);return `- \`${path.posix.basename(f)}\` → \`${path.posix.basename(t)}\`：导入。`}).join('\n')||'本层无目录间直接导入关系。';out+='\n';
 }else{
  for(const f of own){out+=`### ${path.posix.basename(f)}\n\n`;const a=ast.get(f),decl=declarations(f);
   if(!decl.length){const funcs=a?.statements.filter(n=>ts.isFunctionDeclaration(n)&&n.name).map(n=>`  +${n.name.text}()`)||[];const base=node(f).replace('\n}',(funcs.length?'\n'+funcs.slice(0,12).join('\n'):'')+'\n}');out+=diagram([base]);}
   else for(let i=0;i<decl.length;i+=4){const group=decl.slice(i,i+4);const lines=[node(f)];for(const n of group){const key=id(f+'_'+n.name.text),kind=ts.isClassDeclaration(n)?null:ts.isInterfaceDeclaration(n)?'interface':'type';lines.push(`class ${key}["${n.name.text}"] {\n${kind?'  <<'+kind+'>>\n':''}${members(n,a).join('\n')}\n}`);lines.push(`${id(f)} ..> ${key} : 声明`);lines.push(...heritage(f,n,key,group,a));}out+=diagram(lines)+'\n'}
   const references=deps.get(f)||[];if(references.length)out+='直接依赖：'+references.map(t=>`[${link(d,t)}](${link(d,t)})`).join('、')+'。\n';
   out+='\n';
  }
  const edges=[];for(const f of own)for(const t of deps.get(f)||[])if(own.includes(t))edges.push([f,t]);
  if(edges.length){out+='### 本目录调用边界\n\n';for(let i=0;i<edges.length;i+=4){const group=edges.slice(i,i+4),nodes=[...new Set(group.flat())];out+=diagram([...nodes.map(f=>node(f)),...group.map(([f,t])=>`${id(f)} ..> ${id(t)} : 导入依赖`)])+'\n'}}
 }
 out+='\n## 子目录导航\n\n'+(children.length?children.map(c=>`- [${path.posix.basename(c)}/](${path.posix.basename(c)}/ARCHITECTURE.md)：${scope[c]}`).join('\n'):'无子目录。')+'\n';
 if(d!=='src')out+='\n[返回上层](../ARCHITECTURE.md)。\n';
 out+='\n每次修改本目录代码，同步维护文件头、关键契约说明及本图。未实现的治理、证据验收和自动编排能力不列入当前类图。\n';
 const contract=d+'/CONTRACT.md';
 if(fs.existsSync(contract))out+='\n## 设计契约 v1 与落地范围\n\n以下内容区分已接通能力与后续设计；以各节的实现状态为准，不将目标图当作现状图。维护源：[CONTRACT.md](CONTRACT.md)；生成类图时同步附加，勿直接修改本附录。\n\n'+fs.readFileSync(contract,'utf8').trim()+'\n';
 const target=d+'/ARCHITECTURE.md';if(!fs.existsSync(target)||fs.readFileSync(target,'utf8')!==out){changed.push(target);if(!process.argv.includes('--check'))fs.writeFileSync(target,out)}
}
console.log(`${directories.length} 个目录，${files.length} 个代码/样式文件；${changed.length} 份架构文档${process.argv.includes('--check')?'存在差异':'已更新'}。`);
if(process.argv.includes('--check')&&changed.length)process.exitCode=1;
