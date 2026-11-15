---
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
