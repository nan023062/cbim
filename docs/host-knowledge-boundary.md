# 宿主与 CBIM 知识库边界

CBIM 全权管理 `.cbim/`。宿主通过 MCP 查询与修改知识，不直接读取或编辑目录。完整启动流程和 7 项内置 Skill 声明直接写入 AGENTS.md、CLAUDE.md 的 CBIM 管理区块，更新时保留其他规则并备份；已有 AGENTS.override.md 同步，不自动创建 override。CLAUDE.md 不再导入 `.cbim/entry.md`。独立 entry.md 已废弃：不生成、不同步、不作为知识返回；旧文件原样留存。

## 宿主初始化与保护

- `.ignore` 添加 `/.cbim/` 托管过滤，不写 `.gitignore`，避免使正式知识退出版本控制。ignore 不是权限边界。
- `.claude/settings.local.json` 合并 PreToolUse Hook、Read/Edit deny 和沙箱 denyRead/denyWrite。保留其他 Hook、权限和用户设置。macOS/Linux 请求启用沙箱并禁止非沙箱重试；原生 Windows 不支持 Claude shell 沙箱，不能宣称 shell 隔离。
- `.codex/hooks.json` 合并 PreToolUse Hook；`.codex/config.toml` 启用 `codex_hooks`/`hooks` 兼容开关，生成 `cbim-knowledge` 权限配置，继承既有可继承配置或 workspace/read-only 基线，对 `.cbim` 拒绝读写。宿主是否支持这些字段、信任项目及 Hook、启用相应权限模式，决定其是否生效。
- Hook 使用随 CBIM 打包的 `host-guard.js`，由 CBIM.exe 的 Node 模式运行，不依赖系统 Node/Python。拒绝显式 `.cbim` 文件读写、patch、可识别的 shell 访问、知识库内工作目录及可能覆盖知识库的根目录文件搜索；真实路径检查可以识别部分链接别名。本工作区 CBIM MCP 调用放行。
- Hook 输入异常或运行失败返回拒绝；Claude 新版本同时配置 onFailure=block。其他宿主对 Hook 失败的处理必须以其行为为准。
- 修改已有配置前备份，格式损坏、链接或并发修改会保留原配置并在工作区警告中显示。移除工作区不会擅自删除用户配置。

## 真实保障与限制

Hook 是工具调用层的防误操作措施，不是通用代码执行的安全证明。任意脚本间接读取、动态拼接、已有交互 shell 的后续 stdin、专用工具绕过 Hook、其他 MCP、宿主禁用或未信任 Hook 等情况，不能仅靠匹配命令文本保证禁止。严格隔离依赖实际生效的 OS 沙箱/不同权限进程；同一用户以完全访问模式运行宿主时，CBIM 无法仅用配置剥夺其全部文件权限。

2026-11-05 本机可见 Codex CLI 0.114.0，`codex_hooks` 标为 under development；Claude Code 为 2.1.312，运行平台为原生 Windows。测试覆盖生成配置、真实 Hook 子进程输入输出、打包 Hook 和 MCP 访问，不将其冒充真实模型会话已执行所有回调或绕过测试通过。用户需重新开启宿主会话并按宿主要求信任 Hook；CBIM 不自动绕过信任确认。

协议依据：[Codex Hooks](https://developers.openai.com/codex/hooks/)、[Codex Permissions](https://developers.openai.com/codex/permissions/)、[Claude Hooks](https://code.claude.com/docs/en/hooks)、[Claude sandbox](https://code.claude.com/docs/en/sandboxing)。

## 查询及 CRUD

1. cbim_module_registry 按关键词定位模块，cbim_module_get(id) 返回定义、正文和自身 Workflow；不会继承父模块流程。
2. cbim_agent_registry 查询分组/Agent/作者，cbim_people_list 查询真人花名册；cbim_agent_get(id) 返回定义、原则、完整祖先 Skill 链及每项正文、来源、冲突。结构校验失败时必须结合 issues，不能把未登记成功的对象视为业务上不存在。
3. cbim_object_preview(revision, operations) 支持 agent/module/skill/workflow 的 create/update/delete。create 使用 parentId、slug、data、body；update 使用 id 和需要更新的 data/body；delete 使用 id，含子对象时需 cascade。正文由宿主提供，路径、清单、父模块 children 由服务维护。
4. 预览返回 planId、diff、validation、objects。cbim_object_commit(planId) 使用原预览请求事务提交，要求写凭据和桌面 Agent 写入开关；版本冲突、校验失败、越界或继承冲突拒绝提交。同计划重复提交幂等，重启导致实例变化需重新预览。
5. 删除非知识资源暂不支持，返回 OBJECT_ASSETS，不静默删除脚本/资产。只清理空对象目录，清理失败以 cleanupWarnings 返回，正式提交状态仍明确。删除存在外部引用时校验阻止提交，需要同一变更集先解决相关引用。
6. 其他正式知识可用已有 cbim_knowledge_preview/cbim_knowledge_commit 文件事务；使用 MCP 返回的路径。对象接口尚不提供组织组、人员和连接器的专门语义 CRUD，可用现有文件事务编辑已返回的对应定义，缺失创建规划时报告能力缺口。
7. cbim_knowledge_refresh 校验人类或外部工具已发生的知识变动；成功才事务更新派生索引，不修改知识正文，不作为宿主直接文件访问的后门。

非 Markdown/JSON 的脚本资源引用现已检查真实存在性；Markdown/JSON 正文引用仍以事务投影为准，删除知识不能借旧磁盘文件掩盖悬空引用。
# 宿主启动指引同步

AGENTS.md、CLAUDE.md 直接包含启动流程：发现 MCP 工具，调用 `cbim_workspace_identity` 核实工作区，再通过 `cbim_` 工具获取流程、规范及知识。宿主指引不再包含本地 entry 文件路径或读取要求，内置 Skill 声明统一使用 `cbim_skill_` 前缀。

已有工作区在新版启动或重新打开时自动更新 CBIM 托管区块，并清理独立的旧入口导入行。变更前备份原文件；用户自定义内容和其他导入保留。已运行的宿主会话需重新加载启动指引或重启会话。
