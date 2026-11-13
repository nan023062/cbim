

## 执行前缺参

beforeTool 分类/授权之前的 Schema 错误使用 toolInputError 转为字段说明，保存原 Fault 错误码并返回 rejected。工具尚未放行，不能将其解释为未知写入。该路径不重发调用、不补业务参数；原 Workflow/权限/停止/证据失效逻辑保持，执行后的失败依然沿未知结果规则处理。

normalizeToolInput 是可信同步预解析端口：先解析缺省参数，再以相同 input 写 proposed、授权与回执，只有变更时追加 originalInput 保留模型输入。解析失败保留原请求并进入拒绝路径；不能按当前身份重新解释历史日志。知识执行服务绑定同一实例并再次断言，不跨实例切换。此安排保留 originalKnowledgeWrite 从原 proposed 核实知识事务的能力。

## 指定话题补充与排空

主轮整话题补充使用带 interruptionId 的 user-continuation。仅此分支可续接安全 cancelled；beforeRun 必须消费原持久等待，其他可信接续仍要求 completed。日志尾行、未决工具、主对话绑定和原生文件校验全部保留；运行管理器等待旧 runtime 清理完成再创建新轮。
