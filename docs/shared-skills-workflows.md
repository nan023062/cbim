# Team 与 Workspace 树：Skill 继承与模块 Workflow

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

```text
.cbim/
├── project.json
├── README.md
├── team/                              # 根 Team
│   ├── registry.json
│   ├── people.json
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
```

名称仅为示意，不在初始化时生成示例组织、Agent、工程或模块。领域工程按职责组织，不直接等同于物理目录；实际源目录仍由 sources 表达。skills/、workflows/ 及辅助资料目录不计入组织节点或模块 children。

## 初始化清单修正

初始化七个基础文件：project.json、README.md、team/registry.json、team/people.json、team/skills.json、workspace/registry.json、connectors/registry.json。

宿主启动指引内嵌 CBIM 工作提示词，要求 Agent 按“受理目标 → 分类与定位 → 组装能力和模块上下文 → 制定步骤 → 执行 → 验证 → 交付与治理反馈”开展 AI Native 工作流。它规定 Skill 父链解析、当前 Module 专属 Workflow 和权限边界；由宿主实际工具执行，不依赖 CBIM 桌面内置模型。宿主 Agent 与 team/ 下的专业 Agent 定义须区分，读取定义不等于启动独立进程。

模板由 `src/backend/main/host/host-prompt.ts` 提供，不包含安装路径或凭据。CBIM 将正文和内置 Skill 声明直接嵌入 AGENTS.md、CLAUDE.md 及已有 AGENTS.override.md，保留无关规则，变更前备份。已运行会话可能需重启或重新加载指引。`.cbim/entry.md` 已废弃，不再生成、同步或作为知识返回；已有文件原样保留。

所有 CBIM 流程必须先查询目标工作区的 CBIM MCP，包含只读咨询和任务恢复。入口自身在连接前读取；索引、定义、Skill/Workflow 正文与版本均通过 MCP 查询。服务不可用时暂停，不用直接文件读取、旧脚本或缓存作为替代。业务产物可用宿主工具操作，但须遵守查询后确定的范围和授权。

以上继承、定位与加载规则由 CBIM MCP 实现，宿主不执行父链遍历、清单合并或引用加载。知识增删改查同样由接口处理；宿主使用服务返回的对象标识、内容、版本和操作结果。完整任务上下文接口仍需实现，当前基础快照接口不等于已完成全部知识加载抽象。

- team/skills.json 初始为 `{"skills": []}`；首次初始化预建空 team/skills/。已有工作区无定义时允许目录不存在，不依赖 Git 保存空目录。
- workspace/registry.json 初始为 `{"modules": []}`，后续登记确认的领域工程和模块。
- 不创建 workspace/workflows.json、根级 workflows/ 或模块共享流程清单。
- 后续创建小组或 Agent 时登记自身 Skill；创建工程或模块时登记自身 Workflow。
- 不自动导入能力、流程或业务模板；启动配置仍待审核。

先前提出的“最近共同父模块存放共享 Workflow，后代继承”方案撤销。模块专属 Workflow 规则继续沿用。首次打开缺少 .cbim 的工作区时，在临时目录创建全部骨架后同盘重命名，随后启动知识服务和 MCP；已有 .cbim 不覆盖。层级命名、领域工程节点校验和交互式初始化引导仍需后续单独实现。
