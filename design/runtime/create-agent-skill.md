---
name: create-agent-skill
description: 为已有 Agent、Team 或小组创建专业 Skill，维护归属清单并核实继承。
---
# 创建专业 Skill

遵循[通用规范](builtin:common-rules)、[Agent 规范](builtin:agent-spec)、[Team Skill Schema](builtin:team-skills-schema)、[共享方法结构](builtin:shared-skills-workflows)。本流程只维护工作区团队 Skill，不修改应用内置流程，不自动执行新 Skill 描述的业务操作。

1. 通过 cbim_agent_registry、cbim_agent_get 明确实际使用者、已有方法与祖先继承，核实新增授权。已有同等能力优先复用，避免同名冲突。
2. 专属方法归 Agent；共享方法归能覆盖使用者的最近共同组织节点。不放到兄弟节点，不将内置治理流程复制到每个 Agent。
3. 调用 cbim_object_preview，operations 使用 kind=skill、action=create、parentId=查询返回的所属节点 ID、slug、data（name、purpose）和 body（完整 Skill 正文）。正文写明触发、输入、步骤、输出、验证和失败处理，frontmatter 含 name、description。只创建方法，不自动执行其业务操作。
4. 服务创建正文、更新 Agent 或 Team 的方法清单，并检查继承与引用。核对 diff、归属与影响后，在有效写入授权下 cbim_object_commit(planId)。不直接操作 .cbim 或自行写清单；辅助资源创建接口缺失则记录，不伪造可用脚本。
5. 提交后 cbim_agent_get 查询所有受影响成员的可用列表、正文和来源，确认祖先继承正确、无同名覆盖或兄弟继承。修改方法使用 action=update 与返回的 Skill id，删除使用 action=delete；共享方法修改影响所有继承者。
6. 检查触发条件、步骤与实际工具是否一致。创建成功不等于执行验证通过；交付实际创建、校验结果、影响对象及尚未实跑的部分。
