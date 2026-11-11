# 工作区自动化契约

定义归工作区，运行冻结定义版本，不随配置编辑改写。固定计划为手动、间隔、按 IANA 时区每天及未来一次；不存在自选工作目录。默认 Agent 是主 Agent，成员选择是当前已采纳岗位 ID，不是新建运行实例。

AutomationStorage 只读写有界完整状态，AutomationRunner 提供校验、真实启动、状态观察和停止。启动必须先经 bind 保存实际主 taskId/runId，再执行模型。Unknown 保留原身份并阻止重叠；结果状态不表示业务验收。新日程变化在 schedule.ts，业务派发变化在 Main 适配，不反向改变契约层。
