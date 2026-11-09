# Step49 / R07-B2：真实删除、移动与完整产物证明

日期：2026-11-08。承接本地提交 b787f40；本片独立本地提交，不推送。第1–8组继续，第9组仅计划。

## 实际交付

- Workflow 的 artifactScope.transitions 冻结最多4项不重叠文件删除/移动，源与目标必须在本模块范围，且启用完整出口。模型只选模块、序号和原写前清单，不自报路径或哈希。
- cbim_artifact_transition 复用现有权限及实际成员租约：可靠授权后重核全集合，独占原文件及父目录，保存 prepared/executing 后才发操作。真实文件工人退出后核完整 after，再保存 applied；唯一真实成功回包才产生可引用证明。
- 删除使用同一原文件句柄；移动禁止覆盖且核同对象、原字节及源缺失。完整清单携带原操作证明，JSON、交付、主审阅、人工意见/继续及最终完成复用同一集合身份。普通缺失、晚到 before、部分要求、额外增删改、普通写入或重规划不能冒充成功。
- 坏回包、阶段保存失败、停止或结果未知保留事实及本轮只读/求助屏障，不换调用重发，不自动回滚或恢复。成员面板与人工候选/历史展示两端、原清单、字节摘要及阶段顺序；重开不执行原操作。

## 验证

最终类型、脚本类型（--noEmit）、架构检查通过：51目录、531源码/样式，1020维护文件、5492条含类型依赖、0环，3处既有外部动态加载保持明确审核。

最终冻结相关回归 **45文件、397/397，0失败、0跳过，约312秒**。覆盖新运行/原日志篡改/平台/Pi、旧受控写、完整清单、JSON、人工决定/继续、Workflow、检查点及依赖边界。本片没有重跑全仓；Step46全仓2068是历史证据，不计入本片通过数。较早14项、40项和平台24项是重叠开发验证，不累加为最终总数。

实际 Pi + Electron utility 三场：自动、源重现阻断、人工接受。每场真实启动并退出2个文件工人；记录原阶段、唯一成功工具及完整集合。目标/接受/继续复核包含移动目标内容变化、源路径重现，失败不改原意见、候选、日志或等待。重开没有新操作或模型重放。

最终 EXE **20261108-132722**，三场均通过：

| 场景 | 主/成员请求 | 实际结果 |
| --- | --- | --- |
| automatic | 6/13 | completed |
| changed | 7/13 | failed |
| human | 11/13 | completed |

人工场执行明确选择、重新核实、接受、接受后源重现拒绝继续、重开、恢复完整集合后显式继续；双击只一次受理，原普通草稿保持。页面和传输错误均0。生成13张截图，其中6张人工目检（正常原操作/集合、变化集合、人工匹配/继续拒绝/重开）；两端及记录可读。全部自有成功样本和进程清理，用户原PID71020、旧包20261107-235854保持运行。

## 开发中发现并修复

1. 平台初轮37项中36通过：只有 READ_ATTRIBUTES 的目录句柄未阻止空目标父目录重命名。改为 LIST_DIRECTORY | READ_ATTRIBUTES 后，源和目标父目录的共享删除限制实际生效，新旧平台24/24，最终回归包含该探针。失败报告保留，不把初轮写为全通过。
2. Win32 可选操作分支的类型收窄已修；后续发现引擎 types 反引运行实现形成类型环。改为纯 ArtifactTransitionToolPort，运行实现该接口，引擎无阶段保存或授权签发能力，最终0环。
3. 真实平台成功但引擎回包改写/提前结束，同样保留待核实屏障；原记录验证另拒绝坏 wire，不以模型结束或当前缺失解除。

## 证据与指纹

- [最终检查](../../test-results/artifact-transition-final-checks-final-receipt.json)、[最终回归](../../test-results/artifact-transition-final-targeted.json)、[冻结回执](../../test-results/artifact-transition-final-targeted-receipt.json)、[构建](../../test-results/artifact-transition-final-make-receipt.json)。
- [平台初轮](../../test-results/artifact-transition-platform-initial.json)、[目录锁修复](../../test-results/artifact-transition-platform-lock-fixed.json)、[开发链路40项](../../test-results/artifact-transition-chain-initial.json)、[类型环原失败](../../test-results/artifact-transition-final-checks-receipt.json)。
- 三场 [自动](../../test-results/artifact-transition-automatic-ui-smoke.json)、[变化](../../test-results/artifact-transition-changed-ui-smoke.json)、[人工](../../test-results/artifact-transition-human-ui-smoke.json) EXE回执；实际utility轨迹见同前缀的 pi-evidence.json。
- [产物摘要](../../test-results/artifact-transition-artifacts.json)。源码/配置540项、内置资料21项及测试/脚本524项在最终检查、回归、构建及验收完全一致。

源码：0d6107bff761f8d59be53be2d28d0e8b43134f32ede357f0c17f28d39e65295a

内置资料：21200bd32e5759c346062f33855966204ce2e5fc1b78309c5d5afa1e4f939c1d

测试/脚本：e8be4b2a959dfedbc5a4636cb40cbbff9cb0346e98a9758482e37054e61506ee

- C:/XDTWorkspace/cbim-ai/build/20261108-132722/CBIM Assistant-win32-x64/CBIM.exe：213976576字节，SHA-256 8498d26fb3e65203c5c48e24db2de2a1ea3f230bed7b5978d6ad881c1f408509
- C:/XDTWorkspace/cbim-ai/build/20261108-132722/CBIM Assistant-win32-x64/resources/app.asar：3180089字节，SHA-256 f4e18afd3f3859c407e51d7be8dd2a322759e4d719ec314fc5a6f9e060e85921
- C:/XDTWorkspace/cbim-ai/build/20261108-132722/make/zip/win32/x64/CBIM-Assistant-20261108-132722-win32-x64-0.1.0.zip：180365755字节，SHA-256 43acfa5c7145be9d76fdee60bfe474e15c1b8ef7e424e5028f281de8fa4cfc45

## 维护与限制

同步中文文件头、关键接口/状态说明、10组 CONTRACT/ARCHITECTURE、内置执行规则和路线图。引擎→纯操作协议，运行→平台端口，Main→真实utility；前端只经Bridge读DTO。清单摘要基础独立于日志验证器，包含类型的文件依赖无环。

支持域为本机 Windows x64 / NTFS 既存普通UTF-8单链接文件，≤1MiB，已有父目录，不覆盖移动；拒绝目录递归删除/整体移动、跨卷/网络、链接/硬链接、备用流及不稳定对象。没有全工作区OS隔离、原子快照、未知操作补偿或自动恢复；原失败阶段的统一影响观察适配仍列R03缺口。真实Pi使用本机确定性服务，不代表在线自主质量。

本片R07-B2约定范围完成；R07外部产物与R13真实输出适配仍待验收，R07整包保持部分完成。下一片R08跨等待人工意见适用性与重新决定入口；其它已授权包继续，不把外部服务或真人接管条件挪到第9组。
