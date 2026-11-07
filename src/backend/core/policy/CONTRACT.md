### 可信工具范围与逐次权限评估

四个主治理工具由 `module-governance-tools.ts` 的精确效果表分类。只有非原生、单一匹配效果、严格 `knowledge` scope 且工作区一致的可信描述可用；缺作用域、额外效果、未知治理名、伪原生或跨工作区全部拒绝。这个例外不扩展到其他 read/preview 工具，模型不能传 scope。观察/提案保存私有记录，不产生正式知识写入权限，不触发 ask 模式的知识提交批准；原正式写入门禁保持不变。

`tool-policy.ts` 只消费调度层已识别的工具描述与可信运行权限。副作用决定 read/ask/execute 行为；原生路径守卫先于 ask 审批，拒绝或缺失审批不能放行。命令被标记为 unknown 范围，不据此承诺目录沙箱或已知副作用集合。

`RunToolDescriptor.scope` 为可选的可信装配范围。repository 范围必须匹配本轮 workspaceId、实际 cbim_repository_list/get 名称、connectorId 和操作；仅允许非原生且恰好 read 的工具。缺少捕获范围、跨工作区、混合副作用或模型伪造目标均拒绝。旧工具没有新范围时保持原分类行为；策略只核形状和绑定，真实仓库授权与共享代际仍由主进程端口在网络前后复核。

JSON 验证仅允许准确的 `cbim_validation_run` 名称、非原生且单一 `read` 效果，不因验证取得命令或知识写入权。真实注册仍须由正式成员的冻结要求及平台能力决定；策略不按模型提供的路径或 Schema 授权，不将成功回执当作验证通过。

每次调用独立产生决定；策略不存储凭据、不缓存业务批准、不复制外部资源，也不把只读回执转成任务验收。

### 模块岗位负责人逐次授权

`module-ownership-tool-policy.ts` 的四项精确工具表独立于知识目录。inspect/receipt 为 read，change_preview 为 preview，change_commit 为 knowledge-write；只有非原生、单一匹配效果和当前工作区 knowledge scope 才可分类。未知同前缀、模型传入范围或混合效果不能取得例外。提交在 read 下拒绝，在 ask 下沿真实审批，在 execute 下仍须通过来源、版本和串行事务门禁；授权不代表业务验收或已经按该岗位派发。
