# 团队架构治理

适用于用户在团队架构点击“一键治理”或明确要求治理当前团队。该工作流由当前主 Agent 执行，不创建定时任务。

1. 读取当前知识快照、团队目录、Agent 能力/限制/原则与继承 Skill，结合实际工作和业务模块核实分工，不凭空编造岗位。
2. 找出职责混杂、重复能力、过期知识、缺失正文和继承冲突；说明依据、影响和需要保留的差异，参考架构治理与知识治理 Skill。
3. 在当前授权内使用对象预览修正静态团队知识，查看全部校验问题后提交，保留真实事务回执。对重大职责调整先给出可审阅方案；未批准的事项明确保留。
4. 复查当前快照和有效 Skill。静态定义修改不自动采纳到已有项目岗位。使用 `cbim_member_inspect` 查询岗位及当前/已采纳能力、配置哈希；`OWNER_CAPABILITY_CHANGED` 经 `cbim_member_change_preview` 的 `adopt target=capability` 预览，再按返回 basis/registryCursor 调用 `cbim_member_change_commit`。缺失岗位用 register，名称/职责修订用 update，停用用 state；登记只能继承静态 Agent 已由用户配置的模型。模型/凭据选择及模型参数采纳仍由用户完成。模块来源代次变更才使用 owner 的 adopt_source，不能拿它代替岗位能力采纳。未知提交用 `cbim_member_receipt` 查询原 commandId，不换调用重发，不改写旧任务或运行身份。
5. 汇报实际变更与未解决问题，分别说明知识写入、结构校验和业务/人工验收结果，不能把成功工具调用当作整体业务完成。
