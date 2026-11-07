/** 作用定位：按实际源码生成目录清单与现状类图，并独立附加 CONTRACT.md 的设计契约与落地范围。
 * 设计原因：让未来接口与现状结构分开维护，避免重新生成类图时丢失契约；--check 同时检查两部分漂移。 */
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const scope={
 'src':'应用按前端视图层 frontend 与本机后端逻辑层 backend 分组，bridge 是连接两层的通信边界，不是第三个业务层。目录聚合中的 backend 与 bridge 双向箭头分别来自 main 消费契约、契约重导出 Core 公开类型，不代表文件循环。',
 'src/backend':'本机后端逻辑层：main 装配平台与服务，scheduler-engine 协调执行，core 提供领域与大脑能力。调度单向依赖 Core；后端不导入前端界面。',
 'src/bridge':'前后端通信边界：contracts 声明公开数据，preload 提供 Electron 安全桥。契约可重导出 Core 公开类型和纯函数，不暴露后端服务、凭据和存储实现。',
 'src/backend/core':'核心领域与通用执行契约。大脑、团队、业务模块、知识和工具各自维护语义；不导入 main、调度、IPC 或界面。brain/tasks、knowledge/team/workspace 的目录双向箭头来自不同契约文件，不代表文件级循环。',
 'src/backend/core/foundation':'少量跨领域基础：错误、序列化、严格 JSON、标识及路径端口。files.ts 是 Node 文件原语，不管理应用目录、事务或账户。',
 'src/backend/core/governance':'模块知识治理的纯协议、保护规则与有界主工具投影。可信来源、冻结意见引用与本机评价独立于正式实施，旧意见替代不改历史，不把治理记录当业务验收。',
 'src/backend/core/brain':'引擎无关的执行循环、事件与计量；运行内补充只由可信入口写绑定scope/run/queue的接收日志，返回真实序号；queued后日志失败保持未知。插入绑定原run和停止信号，原生确认与未知分别记录，结算先排空插入日志。正式成员按冻结Workflow验证JSON指定字节，验证与交付复核各持短锁，前后核版本/知识/停止；checked暂存不等于passed有效证明。求助/检查点保存后结束本轮，文件采集随真实工具结束释放短锁；续执行不借旧证据。',
 'src/backend/core/brain/llm':'公开模型参数、能力元数据及运行快照端口。实际配置文件和加密凭据由 main/persistence/settings 持有。',
 'src/backend/core/brain/pi':'Pi 协议、临时桥与运行参数；插入在原生状态查询后复核取消，发送后只凭queued回复确认，不自动重试。工具经一次性gate授权并校验结果；结构验证仅在正式成员有冻结要求及真实端口时公开。受控续执行在启动及加载原生会话后再核冻结证明，回传作为custom数据，不冒充用户授权。',
 'src/backend/core/connectors':'链接器定义、查询与唯一身份检查；当前不执行外部插件。',
 'src/backend/core/knowledge':'知识快照、校验、领域查询、对象变更和可移植静态包规划。团队能力可独立复用，业务模板必须完整；物理事务与预览缓存经端口注入，不携带动态成员或任务。Team/Workspace 只依赖快照辅助，不依赖查询门面。',
 'src/backend/core/policy':'内部运行的统一授权：业务与知识写入共用 read/ask/execute，平台边界不可豁免；不声称操作系统隔离。',
 'src/backend/core/tasks':"任务计划、派发图、目标与等待。运行内补充以持久pending/accepted/rejected/unknown分开，接受与waiting共享连续输入版本，未知阻止完成，普通对话不造计划。流程选择共用叶子契约，缺省与显式分开匹配，已派发选择不可改写；人工与检查点不得跨流程借用旧依据。严格输出区分保存与交付；Workflow出口按当前引用的passed、Schema、基线和原调用重算，历史不补造授权或证据。",
 'src/backend/core/team':"Team、小组、Agent 和父链 Skill 视图、实例及静态角色 Session 履历契约。主实例归主会话，业务实例归周期与任务；履历按角色聚合真实通道，释放或删定义后保留，旧记录不补造实例。",
 'src/backend/core/runtime':'应用级只读监管、真实周期白名单与独立准入契约。周期等待/结算和模型轮次分开，严格传输不补造缺失计量；游标、票据和占用不签发恢复权。',
 'src/backend/core/tools':'工具 Schema、版本、副作用、调用决策、严格提问/答案及回执。提问按原题同序核验，取消与答案排他；during_wait只承诺结束未完成交互。结果只核唯一 JSON 快照，不用解析改写制造成功；历史可读不等于当前业务证据有效。注册、发现及用户回答不授予权限。',
 'src/backend/core/workspace':'领域工程、Module、本模块Workflow与显式维护关系。可选执行条件含工具回执和指定JSON文件结构；有界Schema白名单及纯字节校验拒绝引用/脚本/转换，不自行读文件或签发业务验收。作者与维护人分开，与main/workspace生命周期分开。',
 'src/bridge/contracts':'可序列化 IPC 与展示契约；目标摘要公开运行内补充计数与未核实状态，详情保留已接收快照，纯协议不携IO。排队插入必须传用户点击时的原主run，缺失不推测当前轮次。图增量公开检查点及续执行预约，私有恢复证明留在后端。结构验证只公开当时文件/规则指纹及无原值诊断，不含Schema或正文；人工决定与文件观察保留真实依据，不签发启动许可。',
 'src/backend/scheduler-engine':'工作区调度。装配团队上下文与模型工具，协调会话、运行、用户问题和队列；只依赖自身及 Core。',
 'src/backend/scheduler-engine/context':"内置主角色诊断和治理知识，执行者冻结角色/Skill、模块/维护关系、Workflow与规范。显式流程只从本模块挂载清单解析，准备按任务原选择重核，不回退默认或刷新旧绑定；前置替换保留原实例和流程，主角色仍不执行业务。",
 'src/backend/scheduler-engine/conversation':'主 Agent 的规划、审阅与团队管理指引，以及提问、审批和队列。原题与选项独立保存，公开待答列表返回副本，答案与取消只有一次消费；坏回包不重弹。主调度可安排求助补做、替换未启动前置或撤销待办；旧失败不改写，问答不替代人工决定或恢复。',
 'src/backend/scheduler-engine/execution':"主实例与图根共享身份；补充发送前事务预留，ACK后登记新输入；与cycle在途操作一起结算，停止仍先作用引擎，旧计划不再领取，最终门禁核对原接收日志。插入独立停止屏障，在异步准备后复核原run，停止实际引擎不排在插入串行事务之后。只在真实用户交互端口存在时装配提问工具；成员候选和目标审阅排除问答回执，但保留历史事实与真实业务证据。目标分工、派发及人工来源核对原流程选择；交付/审阅从canonical复核要求、真实passed及当前文件。检查点与前置替换不改选；额度/准入等待不消费，停止和重启封存不重放。",
 'src/backend/scheduler-engine/runtime':'监管、履历与全局并发准入职责分离。可靠提交同步周期白名单，scope-only 更新独立游标，未变投影不重复发布；检查点计待办而不占活动名额，报告用量不授予额度或恢复权。',
 'src/backend/scheduler-engine/tools':'把知识、主调度及实际装配的用户交互注册为 cbim_ 工具。QuestionTools在等待前冻结原题，唯一wire严格核验答案或取消，坏回包不重问。主调度八工具使用固定运行身份、原命令映射与严格输出；坏回包先核实原记录。维护和问答回执不算业务证据，执行者不获得调度权。',
 'src/backend/main':"Electron 入口与应用装配。应用单例持有全局准入和持久策略，主/成员共享许可；工作区代际退役撤销等待，已有运行真实退出才释放。注入可信身份及证据，重启不执行历史票据或等待周期。 可信桌面提交注入本机明确操作来源，选定文件核实共用只读租约与平台端口。",
 'src/backend/main/commands':'CLI 入口，复用应用和调度，不拥有第二套领域规则。',
 'src/backend/main/ipc':'应用 action 路由；队列插入传递原expectedRunId，由调度拒绝缺失、过期及停止。公开准入游标读取和版本化设置，不开放许可领取/撤销。报告、核实和业务重规划保持独立；启动额度不足明确未受理，桌面发送方在 Electron 接入处核验。 人工提交参数不接受 actor，保存不启动模型；查询保留历史身份。',
 'src/backend/main/platform':'本机路径、系统锁、凭据加密、终端与工具访问检查。固定根有界读取并核前后句柄/路径，拒绝链接、越界和Windows备用数据流；JSON验证由同一Buffer计算指纹和结构结论，正文不出端口。原生历史不完整拒绝恢复，不承诺外部原子隔离。',
 'src/backend/main/persistence':'本机持久化适配：知识事务、运行日志、对话附件、模型配置。保留原数据路径与格式，目录调整不迁移用户数据。',
 'src/backend/main/governance':'工作区模块知识治理服务、可信桌面操作与独立主运行端口。登记保护、决定及实施只属桌面；模型仅可读取、观察、提案和核查回执；反馈来源在批准与实施前串行复核，未知不重放。',
 'src/backend/main/persistence/governance':'私有治理记录的有界严格持久化，核对真实来源、原命令指纹与不可变提案；旧数据不补造来源，不反向调用知识事务或创建第二条提交队列。',
 'src/backend/main/persistence/knowledge':'正式知识文件读取、初始化、事务恢复和对象计划缓存。提交串行化，回滚不覆盖外部修改，清理仅删除空目录。',
 'src/backend/main/persistence/settings':'应用级模型、并发与新目标软限额存储。密钥系统加密；策略串行版本校验与原子保存，缺文件才使用默认值。软限额只冻结新周期，设置恢复不重放模型或改变既有目标。',
 'src/backend/main/persistence/tasks':'执行日志、附件快照、派发事务与角色履历。日志只读完整前缀并报告未完整尾行，损坏不透传原始片段、不截断修复。图/目标/详情同屏障读取，未知操作不自动重放。',
 'src/backend/main/resources':'链接器、人才和完整业务模板共用的本地/远端资源仓库。静态发布与导入同时核对源仓库和目标知识版本，显式提交复用知识事务；资源定义不等于可执行工具。',
 'src/backend/main/workspace':'本机工作区登记、运行实例与可信桌面静态架构编辑。持锁打开、监听、关闭，知识事务委托 persistence/knowledge；模块维护确认和真人条目同事务，不变更动态任务图。',
 'src/bridge/preload':'固定 Electron IPC 桥；不向页面暴露 Node、凭据或任意磁盘 API。',
 'src/frontend':'React 桌面界面。只消费 contracts 和自身组件，不导入调度或主进程实现。',
 'src/frontend/automation':'工作区内部自动化展示；定时触发尚未实现。',
 'src/frontend/components':'通用展示组件，不持有领域服务与运行状态。',
 'src/frontend/conversation':"中央主对话、目标摘要、输入、附件及队列；两处插入口冻结原run，入队成功保留事实，停止锁独立于插入等待。进程准入等待与持久用户等待分别展示，纯等待不累计工作时长；未受理保留草稿。核实与重规划权限分离，可续聊头由后端核实。 双视图共享人工决定控制器，保存意见不清除聊天草稿或消费等待。",
 'src/frontend/diagnostics':'只读展示工作区运行状态和知识校验问题，不把工作区就绪视为知识校验通过。',
 'src/frontend/runtime':'全局只读运行管理。分别呈现目标周期、人员、任务、准入等待和已报告消耗；单次在途游标读取保留未变行，隐藏时退订，按真实身份定位既有会话而不执行任务。',
 'src/frontend/knowledge':'知识问题、预览提交和静态对象表单；固定编辑基线，模块维护人同事务确认，删除先检查影响。业务架构展示位于 workspace。',
 'src/frontend/governance':'静态业务模块的知识治理面板。展示真实来源、精确差异、补证/异议与回应评价。审阅绑定来源版本，未评价不补造理解，人工决定与实施分开；原命令先保存再发送，未知只查询。',
 'src/frontend/resources':'统一资源仓库的查看、编辑、静态包发布与下载应用。人才按团队/Agent/Skill复用，业务按整套架构应用；工作区身份及预览版本固定。设置通过统一入口打开。',
 'src/frontend/settings':'模型、仓库、并发及新目标软限额配置。并发实时状态不覆盖草稿；软限额默认关闭，显式保存与新周期生效相区分，失败保留输入且不盲目重试。凭据只提交主进程，账户仍为占位。',
 'src/frontend/shell':'工作区侧栏、会话选择、用户栏与右侧扩展页签；会话区与项目级视图区分开。向会话传递活动页签状态，隐藏页签保留草稿/节点选择并降低成员与任务图同步频率。',
 'src/frontend/tasks':"主会话任务图、目标与准入状态；运行内补充按真实接收记录显示，未知优先旧审阅，同版摘要/详情核对后增量呈现。根停止共用会话独立在途标记，插入等待不锁住停止按钮。安全等待补充共享正文、文件/图片草稿及导入锁，按原附件身份冻结请求，切换后丢弃迟到选择，普通聊天草稿独立。目标与节点只显示各自保存的流程选择与冻结绑定，不以当前知识推断旧历史。结构验证按同轮真实工具终态区分未确认、当时符合/不符合和后续操作造成的过期。检查点、基线、人工决定与用量独立核实；跨轮次隔离，不提供读即恢复或把历史当当前验收。",
 'src/frontend/team':'工作区唯一的静态 Team/组/Agent 图及角色维护、继承与人才复用。Agent 节点可按 Session 查看只读执行履历；历史角色独立导航，删定义不回填团队树。详情按需分页，不轮询全量历史或启动执行。',
 'src/frontend/workspace':'工作区唯一的静态领域工程/模块图及自身 Workflow。语义编辑委托 knowledge，完整业务模板复用委托 resources；多个主会话共享定义、动态任务各自独立。',
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
function node(f,label=path.posix.basename(f),directory=false,entries=[]){return `class ${id(f)}["${clean(label)}"] {\n  <<${directory?'directory':f.endsWith('.tsx')?'component':f.endsWith('.css')?'stylesheet':'module'}>>\n${entries.length?entries.join('\n')+'\n':''}}`}
function declarations(f){const a=ast.get(f);return a?a.statements.filter(n=>(ts.isClassDeclaration(n)||ts.isInterfaceDeclaration(n)||ts.isTypeAliasDeclaration(n))&&n.name):[]}
const chunks=(values,size)=>Array.from({length:Math.ceil(values.length/size)},(_,i)=>values.slice(i*size,(i+1)*size));
/** 类型别名只展开本地声明的对象字段；引用和联合分支不伪装成无条件拥有的成员。 */
function objectMembers(type){
 if(ts.isTypeLiteralNode(type))return [...type.members];
 if(ts.isParenthesizedTypeNode(type))return objectMembers(type.type);
 return ts.isIntersectionTypeNode(type)?type.types.flatMap(objectMembers):[];
}
function members(n,a){
 const declared=ts.isTypeAliasDeclaration(n)?objectMembers(n.type):[...(n.members||[])];
 const properties=declared.filter(ts.isConstructorDeclaration).flatMap(c=>c.parameters.filter(p=>p.modifiers?.some(m=>[ts.SyntaxKind.PublicKeyword,ts.SyntaxKind.PrivateKeyword,ts.SyntaxKind.ProtectedKeyword,ts.SyntaxKind.ReadonlyKeyword].includes(m.kind))));
 const visibility=m=>m.modifiers?.some(x=>x.kind===ts.SyntaxKind.PrivateKeyword)?'-':m.modifiers?.some(x=>x.kind===ts.SyntaxKind.ProtectedKeyword)?'#':'+';
 // 公开入口先展示，后续分段保留其余成员；不能用私有字段占满固定名额后截掉生命周期接口。
 return [...new Set([...properties,...declared.filter(m=>m.name&&!ts.isPrivateIdentifier(m.name))]
  .sort((a,b)=>Number(visibility(a)!=='+')-Number(visibility(b)!=='+'))
  .map(m=>`  ${visibility(m)}${clean(m.name.getText(a))}${ts.isMethodDeclaration(m)||ts.isMethodSignature(m)?'()':''}`))];
}
/** 模块公开函数单独成图，文件同时声明接口或类型时也不丢失入口。 */
function exportedFunctions(f){
 const entries=[];
 for(const statement of ast.get(f)?.statements||[]){
  if(!statement.modifiers?.some(m=>m.kind===ts.SyntaxKind.ExportKeyword))continue;
  if(ts.isFunctionDeclaration(statement))entries.push(`  +${clean(statement.name?.text||'default')}()`);
  else if(ts.isVariableStatement(statement))for(const declaration of statement.declarationList.declarations){
   if(ts.isIdentifier(declaration.name)&&declaration.initializer&&(ts.isArrowFunction(declaration.initializer)||ts.isFunctionExpression(declaration.initializer)))entries.push(`  +${clean(declaration.name.text)}()`);
  }
 }
 return [...new Set(entries)];
}
function functionDiagrams(f){
 const groups=chunks(exportedFunctions(f),12);
 return groups.map((group,index)=>(groups.length>1?`公开入口 ${index+1}/${groups.length}（同一模块）。\n\n`:'')+diagram([node(f,undefined,false,group)])+'\n').join('');
}
function heritage(f,n,key,decl,a,visible){
 const lines=[];
 for(const h of n.heritageClauses||[])for(const t of h.types){
  const name=t.expression.getText(a),parent=decl.find(x=>x.name.text===name);
  const target=parent?id(f+'_'+parent.name.text):id(f+'_external_'+name);
  if(!parent)lines.push(`class ${target}["${clean(name)} (外部契约)"] {\n  <<external>>\n}`);
  // 分图不改变声明归属：同文件的父接口在另一段时，仍以同一节点表示其边界。
  else if(!visible.includes(parent)){const kind=ts.isInterfaceDeclaration(parent)?'interface':ts.isTypeAliasDeclaration(parent)?'type':null;lines.push(`class ${target}["${parent.name.text}"] {\n${kind?'  <<'+kind+'>>\n':''}}`)}
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
  for(const f of own){const functions=functionDiagrams(f);if(functions)out+=`\n### ${path.posix.basename(f)} 公开入口\n\n`+functions}
 }else{
  for(const f of own){out+=`### ${path.posix.basename(f)}\n\n`;const a=ast.get(f),decl=declarations(f);
   const functions=functionDiagrams(f);out+=functions;
   if(!decl.length&&!functions)out+=diagram([node(f)]);
   for(const group of chunks(decl,4)){
    const memberGroups=group.map(n=>{const parts=chunks(members(n,a),16);return parts.length?parts:[[]]});
    const count=Math.max(...memberGroups.map(parts=>parts.length));
    for(let section=0;section<count;section++){
     if(count>1)out+=`成员 ${section+1}/${count}（同名节点为同一声明，跨图合并阅读）。\n\n`;
     const lines=[node(f)];
     const visible=group.filter((_,index)=>memberGroups[index][section]);
     group.forEach((n,index)=>{const part=memberGroups[index][section];if(!part)return;const key=id(f+'_'+n.name.text),kind=ts.isClassDeclaration(n)?null:ts.isInterfaceDeclaration(n)?'interface':'type';lines.push(`class ${key}["${n.name.text}"] {\n${kind?'  <<'+kind+'>>\n':''}${part.join('\n')}\n}`);lines.push(`${id(f)} ..> ${key} : 声明`);lines.push(...heritage(f,n,key,decl,a,visible))});
     out+=diagram(lines)+'\n';
    }
   }
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
