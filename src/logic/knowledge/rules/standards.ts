/**
 * 作用定位：知识读取与治理通用规范的代码常量，由所属业务模块维护，供内置资料查询或结构校验使用。
 * 设计原因：正文随业务代码编译发布，消除安装目录文件读取；这里只声明规则，不执行流程或授予权限。
 * 兼容边界：保留迁移前的正文与换行字节，避免仅因存储位置改变使已冻结任务的内容版本失效。
 */
/** 只读流程正文；调用方仍须遵守真实工具权限与业务状态。 */
const commonRules = `# CBIM 内部执行与治理通用规范

CBIM 是本地／多端 AI Native 工作流工具。Agent 对象、执行循环和调度系统分别封装，主与执行 Agent 共用工具执行模型。主 Agent 与用户交互，其他 Agent 与直接调用方交互；知识定义、角色原则和工具反馈都不授予额外权限。

## 查询与实际能力

先核对本轮实际工具目录，使用 cbim_workspace_identity 确认工作区与实例。内置 cbim_skill_* 返回由当前 Agent 执行的方法；cbim_builtin_catalog/cbim_builtin_read 返回只读正文、版本与可解析引用。unavailable 引用记录缺口，不猜安装路径或读取不存在的工具。

业务知识按 cbim_module_registry → cbim_module_get 定位；能力知识按 cbim_agent_registry → cbim_agent_get 定位。能力目录路径不等于可执行岗位标识；调用 Agent 使用当前提供的 cbim_agent_list 的真实标识及可用性。没有 Team 配置时主 Agent 仍可自己完成已授权工作。

Team 是可调用 Agent 的能力配置集合。资料目录分组和 Skill 继承只组织知识，不构成运行调用层级；不读取兄弟节点私有方法，不以能力可见推断授权。

## Agent 调用与反馈

通过 cbim_agent_call 发送目标与必要上下文，等待真实工具返回。被调用 Agent 可以继续调用已注册工具与 Agent；结果和具体问题返回直接调用方，不直接接受用户输入或广播给其他执行者。

调用关系由可信宿主绑定，不能从名称、时间或页面选择猜测。子 Agent 不扩大权限、不复制全部祖先对话、不静默切换模型。原调用可返回 waiting 并由直接调用方通过 cbim_agent_reply 答复；原 task/run 保持不变，根之外不能直接向用户提问。未答复、超额、配置失效或未知恢复必须明确返回限制；不能把停止后的迟到答案当成重启授权。

深度、并发和预算限制显示在工具详情并以工具错误返回。超限不新建频道、不自动无限重试。调用方判断后续动作，只有主 Agent 在需要用户决定时正常提问。

工具成功只是执行事实。产物、验证和用户目标验收分别核实；最终说明已完成、失败、未验证与未知项。停止是请求，真实操作排空后才表示取消或释放完成。

## 知识写入与权限

所有 .cbim/ 查询和修改通过受控 cbim_ 知识服务，不用原生文件工具绕过。对象维护优先 cbim_object_preview → cbim_object_commit，参数使用查询返回的身份、版本和预览依据；创建传 parentId、slug、data、body。Skill 归 Team／分组或 Agent，Workflow 归 Module；删除包含子对象须明确 cascade，知识事务不删除业务资源。

read 仅允许读取与预览；ask 由真实工具批准；execute 仍校验范围、版本、Schema 和事务。模型不能自报批准，子调用也不能继承不适用的“全部通过”。预览不写正式知识，提交回执不是业务交付或人工验收。

cbim_knowledge_preview/commit 保留文件级受控事务，project.json 与派生索引由服务维护。版本冲突重新查询预览，不能直接编辑文件。cbim_knowledge_refresh 只按实际版本契约调用；结果未知核实原请求，不换 ID 重发。

## 未知结果与旧运行

TOOL_OUTPUT_INVALID 或连接中断不代表操作未发生。保留原 run/toolCall 身份，使用实际提供的只读回执入口核实，不能换键重放写入、派发、撤销或预算结算。记录查询失败只重试读取，不再次执行工具。

旧日志恢复仍可能提供 cbim_dispatch_*、cbim_goal_*、成员检查点等旧协议。这些只在该协议实际装配时使用：入队不等于执行，检查点不等于交付，旧人工接受不能自动转成新授权。不得把旧正式成员记录伪造成新的递归调用，也不得为普通问答强制建立旧目标计划。
`.replaceAll('\n', '\r\n');

/** 只读流程正文；调用方仍须遵守真实工具权限与业务状态。 */
const knowledgeQuery = `---
name: knowledge-query
description: 通过 CBIM 内部知识工具定位权威知识、核实证据并回答，默认只读。
---
# 知识查询

遵循[通用规范](builtin:common-rules)。调用本 Skill 只取得流程，不代表已完成调查。

1. 明确问题、范围和需要回答的决定；核对 cbim_workspace_identity。恢复任务先核实当前版本与已有结论。
2. 业务问题先 cbim_module_registry 查询候选模块，再用返回 ID 调用 cbim_module_get，取得知识正文与本模块 Workflow。能力问题先 cbim_agent_registry，再 cbim_agent_get 获取专业定义、原则及继承 Skill。authors 只保存来源说明，不要求登记真人，也不等于授权。
3. cbim_knowledge_search 用于补查相关正文；需要全量校验和版本时 cbim_knowledge_snapshot。不得用旧注册表或缓存冒充当前结果。
4. 区分正式知识、实际业务产物、观察和推断。必要时在授权范围用当前运行的原生工具核查源码或资产；知识正文是依据，不自动证明业务行为。
5. 检查答案是否覆盖问题、来源是否一致、关键引用是否可用。Agent 的继承冲突不能静默选择一个版本；模块流程不能从祖先推导继承。
6. 缺少信息时继续有目标的查询。缺少接口先核对当前运行的工具清单，再记录缺口及可继续步骤，不伪造读取或其他成员执行。
7. 发现知识错误或业务缺陷，交付证据和建议；查询授权不自动变成修复授权。用户已授权修正时按相应流程继续。
8. 回答实际问题，注明来源 ID、版本、事实/推断及未确认项，不仅罗列文件。只读查询不调用写入或刷新接口，除非用户要求同步索引。
`.replaceAll('\n', '\r\n');

/** 只读流程正文；调用方仍须遵守真实工具权限与业务状态。 */
const knowledgeGovernance = `---
name: knowledge-governance
description: 通过 CBIM 内部知识工具检查事实、结构、引用与语义，在有效授权内修正、预检、提交和复核；工具误报与能力缺口独立记录。
---

# 知识治理 Skill

这是 CBIM 内部 Agent 使用的内置治理流程。历史设计 Skill 中的 Python 脚本调用不是当前执行入口。本 Skill 正文只读，项目定制属于团队知识，不覆盖内置规则。

## 1. 确认模式与基线

先核对当前运行工具清单，调用 cbim_workspace_identity 核实目标与实例，再读取 cbim_builtin_catalog 和本 Skill。读取[通用规范](builtin:common-rules)。所有操作由程序绑定当前 workspaceId、instanceId 与运行权限。

用户仅要求检查时保持只读；明确要求修正时，在已有授权内维护，不重复索要同一授权。需要用户审核方案的，审核前不得提交。知识治理授权不自动包含业务源码、架构边界调整或其他工作区。

通过 cbim_knowledge_snapshot 获取当前知识、revision、文件正文与 hash、校验结果。按需 cbim_knowledge_search 补查。记录本轮范围、负责人、已完成操作及采用的内置 version，恢复时重新核对，避免重跑。任务证据遵循[基线规范](builtin:task-baseline)，用当前任务工具登记可承载的信息；缺少专门字段时在对话交付中保留并说明限制。

## 2. 调查并分类

把每项发现列为：知识错误、过时知识、待确认语义、工具误报或缺失能力。记录来源、原引用或相关正文、证据、影响及建议。重复报错也要保留各出现位置。

知识结构按需读取[Module 规范](builtin:module-spec)、[Agent 规范](builtin:agent-spec)、[共享方法结构](builtin:shared-skills-workflows)及清单中的 Schema。内置正文引用由 cbim_builtin_read 返回 references；仅使用其中 available 项的 id 继续读取，不拼接本地文件路径。引用不可用时记录缺口。

规则检查只证明已实现规则的结果。不能把报错直接认定为知识错误；例如非 Markdown/JSON 的脚本被快照排除，可能导致“引用不存在”误报。未取得证据时保留待确认，不删除正确链接、降低规则或伪造文件以消除告警。不通过本地文件操作绕过内部知识工具。

检查旧部署说明、旧目录、过期脚本命令与当前产品是否一致。修正其实际语义，不只移除 Markdown 链接。需要架构决定时依据[架构规范](builtin:architecture-spec)提出证据与待决事项；不擅自批准新架构。

## 3. 形成变更集

基于内部知识工具返回的文件标识与完整正文，提出最小必要修改及影响。保留无关内容和现有正确约束，避免为治理复制第二套权威规范。引用内置规范可以使用服务返回的 builtin:id；它是内置资料标识，不是磁盘路径或自动加载命令。

修改现有文件使用服务返回的 path；知识移动或删除先用 cbim_knowledge_move_preview 获取影响。Agent/Module/Skill/Workflow 使用 cbim_object_preview 由服务规划位置与清单；其他新对象若缺少接口则记录缺口。Team Skill 变更需要核对所有受影响 Agent 的继承；Module Workflow 只归本模块，不继承。

## 4. 预检与提交

对象操作优先 cbim_object_preview，传当前 revision 与 operations（kind、action、id 或 parentId/slug、data、body）。服务返回 planId、完整 diff 和校验；核实后 cbim_object_commit(planId) 提交。创建和修改的正文由当前 Agent 提供，路径与清单由服务维护。不得直接读写 .cbim/。

调用 cbim_knowledge_preview，提交当前 revision、唯一 requestId 和 changes（path 与完整 text，删除为 null）。检查返回的校验问题和影响；不把预检成功当作提交成功。工具误报和既有错误可能阻止提交，遇到此情况明确报告阻塞，继续独立的调查与方案工作，不直接写文件绕过。

需要实际写入时，必须满足用户授权与当前运行权限，再调用 cbim_knowledge_commit。ask 模式的批准由程序收集，read 模式拒绝写入；FORBIDDEN 表示权限或作用域不满足，报告实际原因，不尝试绕过。权限修改对下次发起的运行生效。版本冲突时重新查询、比较变化后重新预检，不覆盖外部修改。请求结果未知时先查询实际状态，不为重试生成新 requestId 盲写。

## 5. 复核与交付

提交后重新 cbim_knowledge_snapshot；需要完整规则检查时调用 cbim_rules_validate，通过 cbim_task_status 等待终态并检查结果。再人工判断正文、定义、引用和执行步骤是否一致，确认变更未引入新的重复权威或职责冲突。未执行的检查不标为通过。

交付按“已修正、待决、工具问题、能力缺口”列出，附实际变更与验证依据。保留治理前后版本、剩余问题及下一步。工具任务完成不等于知识无误，结构通过不等于架构已获批准。
`.replaceAll('\n', '\r\n');

/** 只读流程正文；调用方仍须遵守真实工具权限与业务状态。 */
const sharedSkillsWorkflows = `# Team 与 Workspace 树：Skill 继承与模块 Workflow

本文说明结构与初始化设计。两棵树的层级含义和方法可用范围不同，不将 Skill 的继承规则套用于 Workflow。空工作区初始化已按下述清单实现；领域工程层级校验等后续能力仍需单独实现，已有实际工作区不会自动重写。

## Team 树

- 根节点是 Team，中间非叶子节点是小组，只有叶子节点是 Agent。
- 小组可以继续包含小组或直属 Agent；Agent 不包含任何组织或 Agent 子节点。
- Team、小组、Agent 都有自己的 Skill，清单可以为空。
- **Agent 可用 Skill = 自身 Skill + 父小组 Skill + 各级祖先小组 Skill + 根 Team Skill。**

继承只沿自身到根的唯一父链，不包含兄弟节点或其他 Agent 的 Skill。共享定义保存在所属节点，继承结果不复制到 Agent。

沿用现有文件表达：根 Team 和小组通过 skills.json 登记本节点 Skill，Agent 通过 agent.json.skills 登记自身 Skill；正文均放在所属节点 skills/<slug>/SKILL.md。旧规范将组织节点统称 Team，产品设计明确区分根 Team 和中间小组。

加载时完整解析自身到根的清单，保留来源与入口，空清单不截断继承；执行时按任务需要读取正文。同一继承链的名称或目录 slug 冲突须显式报告，不静默覆盖。可用能力不代表取得工具权限或业务修改授权。

空团队初始化时只创建根容器，不能因为尚无子节点就将根识别为 Agent。现有运行时允许空小组，后续校验需要明确未配置小组的状态，不能仅凭目录是否为空推断 Agent；Skill 及资料目录不计入组织树。

## Workspace 树

- 根节点是 workspace，作为业务组织容器。
- 一级 Module 是按领域划分的工程节点。
- 工程节点以下是各工程的模块节点，可以继续分层。
- 工程节点本身也是 Module；每个 Module 都有自己的 Workflow 清单，可以为空。
- **当前 Module 可用 Workflow = 当前 module.json.workflows，不继承任何父节点流程。**

Agent 的任务基于某个明确的 Module。任务以工程节点为目标时，只使用工程自身的 Workflow；以下属模块为目标时，只使用该模块自己的 Workflow。不自动加入祖先、兄弟或后代模块的流程。

正文保存在所属模块 workflows/<slug>/workflow.md，由同级 module.json.workflows 登记。祖先模块的知识和约束可以按需核实，但不因此扩大当前模块的可用 Workflow。跨模块工作需要明确各任务的目标模块和责任。

workspace 根不承载全局 Workflow，不新增 workspace/workflows.json，也不新增模块级共享 workflows.json。可复用流程可以来自业务模板，但只有显式采用并纳入目标模块自身定义后才成为该模块可用流程；导入与更新机制另行设计，不产生自动继承或跨工作区自动化。

## 目录示意

\`\`\`text
.cbim/
├── project.json
├── README.md
├── team/                              # 根 Team
│   ├── registry.json
│   ├── skills.json                    # 根自身 Skill
│   ├── skills/<slug>/SKILL.md
│   └── production/                    # 小组，非叶子
│       ├── skills.json                # 小组自身 Skill
│       ├── skills/<slug>/SKILL.md
│       └── creator/                   # Agent，叶子
│           ├── agent.json             # skills 仅登记自身定义
│           └── skills/<slug>/SKILL.md
├── workspace/                         # 业务根容器
│   ├── registry.json
│   └── client/                        # 领域工程，一级 Module
│       ├── module.json                # 仅工程自身 workflows
│       ├── module.md
│       ├── workflows/<slug>/workflow.md
│       └── gameplay/                  # 工程中的 Module
│           ├── module.json            # 仅本模块 workflows
│           ├── module.md
│           └── workflows/<slug>/workflow.md
└── connectors/
    └── registry.json
\`\`\`

名称仅为示意，不在初始化时生成示例组织、Agent、工程或模块。领域工程按职责组织，不直接等同于物理目录；实际源目录仍由 sources 表达。skills/、workflows/ 及辅助资料目录不计入组织节点或模块 children。

## 初始化清单修正

初始化六个基础文件：project.json、README.md、team/registry.json、team/skills.json、workspace/registry.json、connectors/registry.json。真人花名册已废弃；旧文件保留，不作为模块创建或派工前置。

内部 Agent 按“受理目标 → 分类与定位 → 组装能力和模块上下文 → 制定步骤 → 执行 → 验证 → 交付与治理反馈”开展工作。调度引擎准备指引、知识版本和运行权限；大脑使用配置的模型与内部工具执行。主 Agent 和定制成员共用大脑内核，静态 Agent 定义与动态 AgentInstance 分离，读取定义不等于启动成员执行。

初始化模板由 \`src/logic/knowledge/storage/knowledge-store.ts\` 维护。内置 Skill 与通用规范由知识工具按 ID 返回，不复制进每个工作区。初始化只创建知识骨架，不改写项目的 AI 工具启动文件、忽略规则或 Hook 配置。

索引、定义、Skill/Workflow 正文与版本通过当前运行的内部知识工具查询。知识不可用时报告实际问题，不用直接文件读取、旧脚本或过期缓存冒充服务结果。业务产物使用运行的原生工具，受当前作用域与 read/ask/execute 权限约束。

以上继承、定位与加载规则由内部知识服务实现，模型不执行父链遍历、清单合并或引用加载。知识增删改查同样由工具处理；Agent 使用服务返回的对象标识、内容、版本和操作结果。显式团队任务已支持模块、成员、有效 Skill 与选定 Workflow 的上下文装配，跨成员任务的自动执行仍需继续实现。

- team/skills.json 初始为 \`{"skills": []}\`；首次初始化预建空 team/skills/。已有工作区无定义时允许目录不存在，不依赖 Git 保存空目录。
- workspace/registry.json 初始为 \`{"modules": []}\`，后续登记确认的领域工程和模块。
- 不创建 workspace/workflows.json、根级 workflows/ 或模块共享流程清单。
- 后续创建小组或 Agent 时登记自身 Skill；创建工程或模块时登记自身 Workflow。
- 不自动导入能力、流程或业务模板；启动配置仍待审核。

模块专属 Workflow 不采用父链继承。首次打开缺少 .cbim 的工作区时，在临时目录创建全部骨架后同盘重命名，随后加载本地知识服务；已有 .cbim 不覆盖。层级命名、领域工程节点校验和交互式初始化引导仍需后续单独实现。
`.replaceAll('\n', '\r\n');

export { commonRules, knowledgeQuery, knowledgeGovernance, sharedSkillsWorkflows };
