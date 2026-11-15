# design 全目录运行资源分离（#92）

日期：2026-11-15。基线：83fb0e33；用户在业务目录拆分后授权扩展到全部 design 目录。

## 已核实边界

按 Builtins 白名单、Rules 的 Schema 加载、Application/Bridge/CLI 装配、资源包收集和文档引用核对全部受版本控制的 design 文件；不是对每份方案的业务完整性审计。保留工作区外其他分支的未提交设计稿，不将其视为可发布资源。

- （根目录）：20 个已跟踪文件
- business：3 个已跟踪文件
- capability：6 个已跟踪文件
- connector：3 个已跟踪文件
- memory：1 个已跟踪文件
- releases：27 个已跟踪文件
- runtime：13 个已跟踪文件
- task：75 个已跟踪文件
- verification：157 个已跟踪文件

| 目录 | 迁出到 assets 的内容 | 保留与原因 |
| --- | --- | --- |
| business | 已在前一提交迁移规范和当前 Schema | BaseModule 设计、旧 Schema 和导航 |
| capability | agent-spec、agent.schema、team-skills.schema、registry.schema | BaseAgent 设计和导航；registry.schema 是规范引用的结构定义 |
| connector | 声明规范与 registry.schema | 设计现状说明和开发方案入口 |
| runtime | 13 份白名单流程、通用规范与方法结构规范 | 仅保留迁移导航，不留正文副本 |
| task | architecture-spec、task-baseline、task-spec、task-loop、base-task | 其余开发方案；这五份虽然含设计描述，但有真实 Builtins 调用，随产品分发 |
| memory | 无 | 记忆机制设计；当前没有运行时加载该文件的消费者 |
| releases | 无 | 发行说明、公钥与历史发布资料；构建按版本读取发行说明，不属于业务运行规则 |
| verification | 无 | 带日期的历史证据与报告，不重写历史路径 |
| （根目录） | 无 | 架构规范、开发记录、UX 文档/原型与其他设计；不随 R 打包 |

## 实际迁移清单

- design/runtime/architecture-governance.md → assets/runtime/architecture-governance.md
- design/runtime/bug-feedback.md → assets/runtime/bug-feedback.md
- design/runtime/business-architecture-governance.md → assets/runtime/business-architecture-governance.md
- design/runtime/business-execution.md → assets/runtime/business-execution.md
- design/runtime/common-rules.md → assets/runtime/common-rules.md
- design/runtime/core-check.md → assets/runtime/core-check.md
- design/runtime/create-agent-skill.md → assets/runtime/create-agent-skill.md
- design/runtime/create-workflow.md → assets/runtime/create-workflow.md
- design/runtime/feature-wish.md → assets/runtime/feature-wish.md
- design/runtime/knowledge-governance.md → assets/runtime/knowledge-governance.md
- design/runtime/knowledge-query.md → assets/runtime/knowledge-query.md
- design/runtime/shared-skills-workflows.md → assets/runtime/shared-skills-workflows.md
- design/runtime/team-architecture-governance.md → assets/runtime/team-architecture-governance.md
- design/capability/agent-spec.md → assets/capability/agent-spec.md
- design/capability/agent.schema.json → assets/capability/agent.schema.json
- design/capability/team-skills.schema.json → assets/capability/team-skills.schema.json
- design/capability/registry.schema.json → assets/capability/registry.schema.json
- design/connector/connector-spec.md → assets/connector/connector-spec.md
- design/connector/registry.schema.json → assets/connector/registry.schema.json
- design/task/architecture-spec.md → assets/task/architecture-spec.md
- design/task/task-baseline.md → assets/task/task-baseline.md
- design/task/task-spec.md → assets/task/task-spec.md
- design/task/task-loop.md → assets/task/task-loop.md
- design/task/base-task.md → assets/task/base-task.md

## 调用链与取舍

Bridge/CLI → Application(assetsRoot) → Rules；自动化、执行上下文、内部知识工具 → rules.assetsRoot → Builtins。R 包仅收集 assets/business、capability、connector、runtime、task 及 legal。branding 仍按原生资源边界打包；design/docs 不再进入 R。

C3 范围内资源边界治理，L2 维护交接：保护现有规则、权限、状态和恢复机制，把资源布局变化限制在装配参数、白名单及打包入口。没有引入新抽象、兼容回退或目录别名。资源只读，用户工程及知识事务布局不变。内置 ID 不变，目录来源和发生链接修正的正文版本按真实内容变化；冻结快照仍按既有规则核验，不能用目录迁移绕过版本拒绝。

四问：职责是分离设计与运行资源；归属是宿主注入只读 assetsRoot；调用链见上；变化局限于资源装配与消费者。第五问候选：没有证据需要引入通用资源加载框架，继续使用现有显式路径和 Builtins 白名单。回退时应整体回退同一提交的资产、装配与打包，不能只恢复旧目录。

## 验证边界

7 文件 60 项通过：rules、builtins、runtime-packaging、ci-validation、connector-definitions、member-execution-context、desktop-update-lifecycle。隔离夹具在没有 design 的目录加载全部 24 个内置条目与 Schema，缺失 Schema 直接拒绝；资源清单证明不携带 design/docs/branding。类型、架构/依赖及测试归属检查通过，文档相对文件链接检查无缺失。自动化消费者补充验证结果见开发记录。

未执行全量回归、真实桌面安装或发布；这些仍由 PR/候选集成阶段验证。历史验证报告不改写成当前结果。
