# 原知识调用的事务核实

Step38 / R03-D1，2026-11-08 约定范围已完成，承接 Step37 提交 ae7d7b5。见[实际验证](../verification/knowledge-effect-verification-20261108.md)。承接 R03-B 的原调用影响面板，不新建第二套恢复入口。

## 用户可见结果

在主运行原调用的“核实当前影响”中，`cbim_knowledge_commit` 和 `cbim_object_commit` 显示原知识事务的持久阶段。原工具失败、原事务已提交及今天的知识状态分别表达。明确处置继续沿原处置协议保存，可关联独立核实或新修复；查询本身不重新提交、恢复事务、刷新索引或修剪目录。

## 精确支持矩阵

| 原调用 | 本片依据 | 限制 |
| --- | --- | --- |
| cbim_knowledge_commit | 原 canonical 的实际参数解析结果、完整原 request fingerprint、原 journal 和来源/治理校验 | 未查到只表示 absent；不证明从未执行，不检查今天正文相同与否 |
| cbim_object_commit | 原实例与 planId、受控私有原计划、完整原 request、同一 journal | 不生成预览或补计划；不证明空目录修剪成功，丢失/损坏计划保留不可核实 |
| cbim_knowledge_refresh | 暂不纳入 | 旧输入只有工作区身份，真实内部 requestId 没有原调用绑定；不按最新/当前知识猜测 |
| 治理观察/提案、负责人变更、受控文件 | R03-D 后续适配 | 使用各自原命令和持久事实，不能混用知识请求或 DispatchStore 提交证明 |
| 任意 shell、外部操作 | 沿既有不支持诊断 | 无原幂等/查询协议时未知保持，不重放 |

## 结构与边界

- Core 纯叶子定义有界知识事务摘要：原请求身份、request 指纹、状态、原事务摘要；不包含正文、路径清单、private/native 路径或授权字段。
- 实际知识工具与核实适配共享输入解析定义，严格保留当前注册表真实的字段正规化及顺序；查询不调用需要当前实例的写入口，旧实例只能读取原请求。
- Main KnowledgeStore 沿现有串行队列只读原 journal，复用原 request/来源/治理核验；投影 prepared/committing/committed/rolled_back/recovery_required，结果异常保持不可核实。计划必须由原固定缓存读取并核身份、指纹、大小和普通文件约束。
- Scheduler 仅在原主身份、唯一 scope、完整 canonical、唯一 proposed/allowed 和原 knowledge-write / knowledge 范围授权均可信时调用窄端口。两次读取核摘要稳定；变化标 changed_during_read，不保存确定处置依据。
- 原 request/计划、事务、canonical、native 和图谱不改。处置只冻结当时报告；后续业务沿既有新周期协议，不重新启用旧调用。
- 主线程不持 Store 事务等待知识 IO；知识队列内不得回调自身。公开输出继续受 128 KiB 与 16 选定调用上限保护，旧处置不补字段或改 basis。

## 验收

1. 原提交成功后回复丢失仍显示 committed，原工具保持 failed/unknown；原请求相同字节及重开读取不写盘、不启动模型。
2. prepared/committing/rolled_back/recovery_required 各保留原阶段；absent 与损坏不变成未执行，错实例/错请求/错 plan/错授权/坏尾/字段混入不冒领记录。
3. 查询期间事务变化使观察过期；停止拒绝后续读取与处置；历史处置 basis 原样重放。
4. 实际 Pi 通过严格知识写工具提交真实知识，丢一次回包后界面显式核实，保存明确处置，重开无重放；最终 Windows EXE 记录实际字节/请求计数和页面错误。
5. 受影响中文注释、CONTRACT 与类图同步；类型、依赖、架构及相关回归通过，完成记录后独立本地提交。不推送，第 9 组只计划。
