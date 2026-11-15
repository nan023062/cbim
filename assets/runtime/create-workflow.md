---
name: create-workflow
description: 为已有 Module 创建独立 Workflow，经内部知识工具维护清单并验证。
---
# 创建模块 Workflow

遵循[通用规范](builtin:common-rules)、[Module 规范](builtin:module-spec)和[共享方法结构](builtin:shared-skills-workflows)。创建流程不自动执行流程中的业务操作。

1. cbim_module_registry → cbim_module_get 定位目标模块、职责与现有流程，核实新增授权、重复内容和边界。
2. 明确触发、输入、约束、步骤、所需能力、输出、验收及失败恢复方式。工具名称以实际发现为准。
3. 调用 cbim_object_preview，operations 使用 kind=workflow、action=create、parentId=目标 Module ID、slug、data（name）、body（完整流程）。服务规划正文位置并维护清单，不直接操作 .cbim。
4. Workflow 只属于本模块，不继承父模块、领域工程、兄弟或 workspace 根的流程。跨模块任务分别核实步骤。
5. 核对 diff 与校验，取得有效写入授权后 cbim_object_commit(planId)，再 cbim_module_get 核实。更新和删除使用返回的 Workflow id，通过相同预览提交流程完成。
6. 核实可执行性、失败分支与验证依据；未实跑只能报告静态检查结果，交付归属、变更、验证和待确认项。
