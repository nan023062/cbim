# 安全等待时补充文件和图片

状态：2026-11-07，Step24 完成，承接 `6ba9fb6`。本片复用现有附件快照和视觉输入，为同一目标的显式继续增加文件/图片，不扩大到网页、目录、链接器或自动恢复。

## 已实现边界

- `GoalContinuationRequest.input` 增加可选去重 `attachmentIds`，仍须一句补充正文。原正文与引用共同进入稳定请求指纹、受理记录及回执比对；旧文本记录保持原形状。
- Main 的 `ChatInputs` 从本工作区私有快照准备一次，返回模型正文、图片与紧凑清单（ID、类型、内容摘要）；不重读原文件。相同字节用于提示和视觉输入，清单随 `beforeRun` 受理保存，scope 不反复复制正文或 base64。附件展开正文设独立总量上限。
- 先查原命令回执；已受理重复请求只返回原事实，即使原附件已丢失。首次缺失、跨工作区、损坏、超限或模型不支持图片，应在消费 waiting 前拒绝。准备期间停止或准入/预算不足不消费；已受理后的未知结果只查询，不自动重放。
- Pi 的 `user-continuation` 使用真实用户补充和独立 images；成员结果回注不重复追加图片，主实例和原生通道保持。附件不充当业务验证、人工接受或提权依据。
- `ScopeContinuationForm` 复用真实文件选择和附件预览，列表归共享控制器，主卡和任务根同步。普通 composer 草稿/附件不变；迟到导入绑定 workspace/root/scope/wait，不能进入新目标。提交后冻结原附件 IDs，未知结果保留原命令；无磁盘路径的剪贴板图片仍不冒称支持。

## 已有基础与验收安排

现有快照限额为12项、单图5 MiB、图片合计20 MiB，PNG/JPEG/GIF/WEBP；文本包含截取说明，其他二进制仅引用。实施时先核实实际限制与接口，不复制另一套附件仓库。

## 实际接口与受理顺序

`ChatInputs.prepareContinuation(message, ids, signal)` 返回同一次快照读取生成的 `{message, images, manifest}`。manifest 为 version 1，items 与 UUID IDs 完全同序，记录 `attachmentId/kind:file/contentKind/name/note?/snapshotHash/contentHash/byteLength/mimeType?`，另有展开正文的 hash/bytes。图片内容指纹对应解码字节；文本仅表示保存的快照，不冒称原文件全量。展开正文上限512 KiB UTF-8，原正文64k字符及累计256k规则保留。

Main 注入可信准备端口给执行管理器；`ExecutionLaunchContext.preparedInputImages` 存在时模型工厂不得再按 IDs 读取。图片不进入后续批次 options。`acceptContinuation(request, task, runId, {attachmentManifest, signal})` 把清单交给原等待受理事务，模型和 IPC 不能注入清单。原用户 message 不被展开正文覆盖。

顺序为原回执查询 → 当前 waiting 与主运行核实 → 登记 pending 停止信号 → 一次附件准备 → 同一实际模型配置的视觉预检 → 准入与运行占用 → beforeRun 中预算、等待版本和停止复核 → 保存意图及清单 → 原生通道/Pi。预算核实等 await 之后、提交前复查 signal。提交后的停止和引擎错误保留事实，不能回滚为未受理。

非视觉模型配置可以受理前明确拒绝；Pi 实际初始化/能力检查仍在受理之后，该阶段失败不能宣称 waiting 未消费。专用 `GOAL_ATTACHMENT_*` 仅用于确定未受理的附件错误，前端不把通用引擎或通信失败误分类为可换请求重发。普通聊天附件与补充附件各自维护草稿；目标补充共享控制器持有导入锁，迟到选择器结果需核对当前 waiting 身份，旧目标不得接受新附件。

单元/组合覆盖同一快照、图片字节、工作区隔离、缺失与非视觉模型不消费、停止窗口、回执丢失后查询/幂等、双表单一致及普通草稿保留。真实 Pi 和 Windows EXE 在隔离工作区通过实际选择器添加临时文本与PNG，在 waiting 中显式继续；核对原scope/主实例/原生通道和新run、准确图片字节、重开不重放。确定性供应商不证明在线视觉理解质量。

## 当前验证事实

初轮全仓221文件1309/1309通过。随后审阅补强已受理回执不可变检查与原生多选超过12项的导入前拒绝；最终8文件61/61及13项边界通过，类型和架构再次通过，未第二次全仓。51目录384源码/样式、687维护文件3227条含类型依赖、0循环，7份类图及相关中文注释/CONTRACT已同步。

最终 Windows EXE 为 `build/20261107-175901/CBIM Assistant-win32-x64/CBIM.exe`。正常与丢回包重开场景均通过，主/成员请求各13/10，页面和通信错误0。5次实际原生文件选择覆盖普通草稿、文本和PNG，以及13项超量明确拒绝且零导入；两处补充表单共享、普通草稿保留、原图片字节与manifest一致，原生仅一条图片用户消息，重开没有重放。结果见[验收报告](../verification/waiting-attachments-20261107.md)。本片不代表整个开发路线图完成。
