# 正式知识物理事务

`KnowledgeStore` 是正式知识写入的唯一串行队列。所有普通提交继续核实例、读取版本、完整结构、逐文件外部冲突及原请求幂等；治理登记和决定通过 `governed` 共享此队列，避免批准检查与提交之间出现其他决定或写入。

`governance-port.ts` 只声明 Main 内部端口，不进入 ChangeRequest 或模型工具输入。普通 `commit(request)` 永远不接 permit。可信 `apply(intentId)` 由私有治理账本解析精确请求，最终投影门禁在 prepared journal 之前执行；任何准备失败都不取得额外权限。

Journal 的可选 governance 绑定保留 intent/protection/proposal/decision ID；旧无治理日志保持兼容。只读原回执同时核完整请求指纹、before/after 键和值、请求差异、派生索引范围及 committed.changed。治理日志再核私有提案的精确前后正文；仅形状合法的 result 不代表真实知识已提交。

新提交在进入队列和开始时仍要求 running。已经开始事务、正在验证投影或治理门禁时，close/restart 只进入 closing 并等待 drain；门禁返回后继续核原身份和知识版本，不把 closing 当成取消已受理提交。治理实施在进入实际知识事务之后遵循同一规则；尚未开始的旧意图不会因此自动执行。

重开对原未完成事务执行既有安全回滚，不重放实施意图。治理记录按文件 ID 和私有 intent 双向识别，在回滚前验证来源；删除 journal 内的 governance 字段不能绕过核验。已提交之后的展示或响应失败不会撤销知识结果，后续查询只读取原日志。关闭等待队列排空再释放工作区锁。
