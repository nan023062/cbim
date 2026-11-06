# 当前宿主接入与对象接口

当前发布 7 个独立 Skill 工具、21 项内置资料和 26 个 MCP 工具。新增 cbim_skill_knowledge_query、cbim_skill_business_execution、cbim_skill_knowledge_governance、cbim_skill_architecture_governance、cbim_skill_create_agent_skill、cbim_skill_create_workflow、cbim_skill_core_check；各工具返回流程，不自动执行任务。

对象查询为 cbim_module_registry、cbim_module_get、cbim_agent_registry、cbim_people_list、cbim_agent_get；增删改为 cbim_object_preview/cbim_object_commit；cbim_knowledge_refresh 供重新校验及刷新派生注册表。完整入口及 Skill 声明嵌入 AGENTS.md/CLAUDE.md，宿主不读取 .cbim/entry.md。知识访问限制、Hook、权限配置和已知边界见 [宿主知识边界](host-knowledge-boundary.md)。

# MCP 接口与发现

每个工作区在 127.0.0.1 分配独立端口，使用官方 TypeScript SDK 的 Streamable HTTP `/mcp/<workspaceId>/<instanceId>`。正式 SDK Client 完成 initialize 与 cbim_workspace_identity 后才发布发现文件。

客户端调用 `src/backend/main/mcp/discovery.ts` connectWorkspace：真实路径 → id → 用户根下 discovery.json → 检查 root/id/instanceId → credentials.json → 连接 → 再次核验身份。未运行不自动打开，过期实例要求重新发现。

发现字段包含 version、protocol、workspaceId、root、instanceId、pid、url、createdAt、credentialFile。PID 不是存活凭证。

必须携带 Bearer 读/写令牌，拒绝非 loopback Host 和携带 Origin 的浏览器请求。Agent 提交还需桌面本次运行开启写权限。MCP 不提供启动应用、打开工作区、设置写权限或任意 shell 操作。

| 工具 | 行为 |
|---|---|
| cbim_workspace_identity | 返回工程、路径、实例与运行状态 |
| cbim_knowledge_snapshot | 正式知识、版本、模块树、规则结果、Skill 继承 |
| cbim_knowledge_search | 路径和正文检索 |
| cbim_knowledge_preview | 校验变更并返回 diff 与影响，不写入 |
| cbim_knowledge_commit | 经版本、身份、权限和规则校验后事务提交 |
| cbim_knowledge_move_preview | from/to，to=null 删除，返回完整事务预览 |
| cbim_rules_validate | 启动确定性校验任务 |
| cbim_task_status / cbim_task_cancel | 查询或取消工作区任务 |

除 identity，工具都要求 workspaceId、instanceId。写入增加 revision、requestId、changes。changes 为 `[{path:'.cbim/…',text:'内容或 null'}]`，最多 1000 项；注册表由程序生成，不能直接编辑。requestId 为 8–100 位字母、数字、下划线或连字符。

工具失败返回 MCP isError 和 `{code,message,workspaceId}`，例如 CONFLICT、VALIDATION、STALE_INSTANCE、FORBIDDEN、PATH、RECOVERY、NOT_RUNNING。HTTP 401 是凭据错误，403 是 Host/Origin 错误，503 是关闭中。凭据不写日志。

HTTP 接收超时 30 秒，头超时 10 秒。长检查使用任务 id 查询/取消，提交期间不强杀；先完成或回滚再关闭连接。取消是协作式，不保证 CPU 检查即时抢占。移除工作区登记停止对应入口，不影响其他服务；关闭工作区页面不停止入口。

命令：`pnpm cli --root "<工程根>" --query "资源"` 或 `--validate`，测试可增加 `--user-data "<隔离根>"`。只连接已运行实例。


## 自动接入与常驻生命周期

CBIM 启动即启动全部登记工作区，忽略旧版可选恢复开关；新增登记立即启动。每个工作区独立锁、端口、实例身份与令牌。失败单独保留状态，不阻止其他服务。页面切换、关闭页面或全部页签均不停止 MCP；移除登记停止对应服务，退出 CBIM 统一等待事务结束后关闭所有服务。后台启动仍执行版本检查和事务恢复，不绕过知识错误或路径检查。

每次打开工作区（包括后台启动）自动检查 Codex 的  .codex/config.toml  和 Claude Code 的  .mcp.json 。配置名为  cbim-<完整 workspaceId> ，不同工作区不会共用目标。缺失时创建；已有 CBIM 管理条目更新到当前运行程序路径，其他服务器、注释和设置保留。修改既有文件前写入同目录  .cbim-backup ；格式损坏、同名非托管条目或链接路径不覆盖，显示警告并允许 MCP 继续运行。文件没有变化时不重复写入。手动修复后再次打开或点击“检查宿主配置”。

宿主启动的是打包在 CBIM 内的 stdio 桥接程序，使用 Electron 自带 Node 运行时（ELECTRON_RUN_AS_NODE），无需另装 Node/Python。桥接每次请求读取用户目录的发现记录，核验工作区与当前实例后转发到实例唯一 HTTP 链接。凭据只在用户目录，宿主项目配置不含令牌。CBIM 重启会生成新实例链接，已运行桥接可重新发现；旧请求身份不会改写，写入不会自动重试。写操作仍需桌面开启本次实例的 Agent 写权限。

项目配置包含当前电脑的 CBIM 程序路径、用户目录及项目路径，属于本机生成配置，不适合作为团队跨机器的统一配置。更换 CBIM 构建位置后，启动 CBIM 会刷新托管条目；宿主若缓存旧命令需重新加载 MCP 或重启会话。首版自动安装上述两类宿主配置，不代表已验证 Codex/Claude Code 的交互客户端，同时自动维护 AGENTS.md、CLAUDE.md 的启动指引，详见下文。

Codex 的项目配置需要项目受信任；Claude Code 交互会话可能要求批准项目 MCP。CBIM 不绕过宿主的信任或批准机制。本地桥接仅支持同机、可访问相同用户目录的宿主，云端或远端宿主尚未接入。

配置格式参考：[Codex MCP](https://developers.openai.com/codex/mcp)、[Claude Code MCP](https://code.claude.com/docs/en/mcp)。


## 服务存活、活动与手动重启

每个 Workspace 独立维护 MCP 指标，不汇总其他工作区。服务每 5 秒用正式 SDK 进行 initialize 和 cbim_workspace_identity 健康检查，单次请求超时 3 秒，不重叠检查。成功显示在线，失败显示连接异常；界面每 1.2 秒读取指标，超过 15 秒无新健康结果显示等待检查，不把进程内 running 状态直接等同于连接健康。

业务指标包含请求次数、进行中请求、错误次数、最近活动、收到／发出的 HTTP 正文字节和最近 5 秒平均速率；↑ 是服务发给宿主，↓ 是服务收到宿主数据。HTTP 头不计入字节，健康检查不计入请求数、流量或最近活动。错误统计覆盖 HTTP 错误、工具执行错误与中断响应；无状态 HTTP 的进行中请求不等于在线宿主人数。

桌面 restartMcp 仅重启指定工作区，不暴露给宿主 MCP。重复重启请求合并；先拒绝新操作，等待正在提交的事务完成，取消未完成工具任务，再释放旧服务并重新加载原知识。新实例重新生成端口、身份和令牌，指标归零，写入授权恢复关闭；其他工作区不受影响。宿主桥接重新发现新实例，旧实例参数仍被拒绝，不能自动重放写入。失败在该工作区显示并允许重试。

## 废弃独立入口文件

不再生成、同步或备份 `.cbim/entry.md`，也不将遗留文件纳入知识快照或编辑接口。旧文件原样留存，不影响正常知识版本；宿主不读取它。启动提示词由 `src/backend/main/host/host-prompt.ts` 提供，直接嵌入宿主启动指引并供内部 Loop 使用。

## 宿主自动读取入口

每次打开工作区（包括应用启动恢复、主动重启 MCP）在补齐 MCP 配置后同步项目根 AGENTS.md 和 CLAUDE.md。若已有 AGENTS.override.md，也同步其中的 CBIM 区块，避免其优先级使普通 AGENTS.md 被忽略；不会主动创建 override 文件，也不会修改用户全局或递归修改子目录指引。

指引使用独立的 BEGIN CBIM ENTRY / END CBIM ENTRY HTML 注释区块，直接嵌入完整启动流程和内置 Skill 声明，不再要求读取或导入 .cbim/entry.md。两者都要求核实 MCP 工作区身份、通过 MCP 查询和修改知识，且不因恢复会话重跑已完成操作。区块位于普通正文前（保留已有 BOM 和 YAML frontmatter），现有区块只就地替换，其他内容保持原样；相同内容不写入、不重复备份。

修改既有指引前，完整原文件备份至用户数据根/<workspaceId>/host-instructions-backups/，文件名含原名称、UTC 时间和唯一标识。备份不进入项目知识库。遇到重复或残缺区块、链接、目录、非 UTF-8 文件、备份失败或并发修改时保留原文件，在工作区设置显示警告；另一个宿主和 MCP 服务仍可正常使用。缺失文件直接创建。

这里只安装宿主支持的启动指引，不绕过宿主信任机制，不强制刷新已经运行的会话。Codex 的指令大小限制、子目录覆盖和自定义宿主配置可能影响加载；已打开的宿主请重新启动会话。未实测 Codex/Claude Code 交互客户端自动读取的全过程；已验证生成、合并、备份和打包安装。其他宿主若支持 AGENTS.md 可按其自身规则读取，否则需专门适配。

官方依据：[Codex AGENTS.md](https://developers.openai.com/codex/guides/agents-md)、[Claude Code 文件导入](https://code.claude.com/docs/en/memory#import-additional-files)。


## 调用诊断与查询返回值

每个工作区独立记录非心跳 HTTP/MCP 调用：时间、实例、方法、工具、状态、错误码及摘要、耗时和收发正文字节。包括工具失败、SDK 参数检查与未知方法错误、HTTP 鉴权失败和响应中断。无状态服务的 GET/DELETE 可能返回方法不支持，日志按实际状态显示，不能仅凭错误计数判断知识库损坏。日志不保存完整参数、搜索词、知识正文或请求头；错误摘要限长并移除实例凭据。大请求/响应的协议元数据解析限制为 64 KiB，超出时只保留可获得的工具信息及计数。

桌面 MCP 面板可展开“调用日志”，每 1.2 秒刷新，筛选错误或搜索工具／错误码；显示本工作区最近 200 条（含重启前实例）。本机文件为用户数据根/<workspaceId>/logs/mcp-calls.ndjson，约 2 MiB 轮转到 .1，保留两个文件；日志不进入项目知识库。写入失败在日志面板显示，不中断知识请求。旧版本没有记录的明细无法补回。连接未到达 HTTP 服务的宿主启动或桥接错误仍需查看宿主侧报错。

工作区“知识校验：N 条错误”独立于 MCP 存活状态，来自当前知识结构校验。顶部可展开逐条查看问题文件、错误码与原因，并重新检查。结构错误不会阻止只读查询，但正式知识提交要求结构校验通过。修复后的快照会更新计数，不再保留旧的泛化警告。

现有 cbim_knowledge_snapshot 请求传 workspaceId 和 instanceId，返回知识快照、revision、files 及校验结果。每个 files 元素包含 path、text（完整正文）和 hash；cbim_knowledge_search 额外接收 query，按文件路径或正文匹配并返回匹配文件的同样结构。宿主不需要根据 path 再访问本地文件。Agent 定义及 Skill 正文目前通过这些基础接口返回，尚无专用的 Agent 语义查询接口。知识写入接口仍是 changes 中的 path 和 text（null 表示删除）加版本与请求标识；当前不能描述为已实现完整对象级 CRUD。
# 内置知识治理入口

新增只读工具 `cbim_builtin_catalog`、`cbim_builtin_read`，均需当前 workspaceId 与 instanceId，接受正常读取凭据，无需开启 Agent 写入。stdio 桥接透明转发工具发现及调用。

- `cbim_builtin_catalog` 返回 entryId、清单 revision、items（id/kind/title/source/version/readOnly）及运行约束；当前发布 21 项，包含七个内置 Skill、通用执行规范、Module/Agent/Task 等规范及 Schema。
- `cbim_builtin_read` 接受清单中的 id，可选 expectedVersion，返回完整 text、SHA-256 version 和 references。references 标记 available/same_document/external/unavailable；available 项返回下一个可查询 id，由服务解析引用，不要求宿主计算安装路径。
- 未登记 ID 返回 BUILTIN_NOT_FOUND；固定版本不符返回 BUILTIN_VERSION_CHANGED。内置内容只读，不混入项目知识快照，也不能经 cbim_knowledge_commit 修改。source 是来源说明，不是让宿主打开的绝对路径。
- 运行版治理 Skill 位于 `design/runtime/knowledge-governance.md`；旧设计 Skill 的 Python 工具流程不作为运行入口。内置参考规范仍可能包含历史存储或执行细节，以返回的运行约束和实际能力清单约束访问；未发布引用明确返回 unavailable。
- 工作区打开时同步宿主启动指引，引导发现这两个接口。内置资料随 EXE 的 design/docs 资源一起交付，不依赖开发工程或网络。

宿主流程：tools/list → cbim_workspace_identity → cbim_builtin_catalog → cbim_builtin_read(entryId) → 按返回引用读取规范 → cbim_knowledge_snapshot/cbim_knowledge_search → 在授权范围内预检、提交、复核。用户没有授权知识修改时保持只读。非正文脚本引用的误报已修正，其他校验失败必须如实记录，不能绕过 MCP。
