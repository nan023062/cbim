# 运行装配的上下文边界

`member-dispatch` 在成员领取提交后读取唯一 DispatchStore，按该轮冻结 `topicContext` 引用解析当前办公室、话题和角色的有界资料，再交给共用 `memberExecutionPrompt`。版本或引用变化拒绝启动，不回退到最近话题；上下文引用不另存一份聊天正文。Pi、Claude Code、Codex 共用这条装配链，仍沿原任务的原生身份和检查点证明执行。

其他装配入口继续由 Application 持有唯一生命周期；本模块不成为第二份调度状态源，不把界面选择或角色名称当作授权。

### 多角色装配

主运行解析 options.modelRoles；成员运行消费领取事务冻结的 ResolvedEngineModel，不二次查询选型。主模型及附加角色凭据都只存在可信准备结果，公开任务快照只保存无密钥配置。

### 逐角色预算工厂传播

主/成员装配把统一适配器请求的 role 传给同一工作区 ModelRequestBudgetService.forRun；省略 role 沿 primary。角色身份、配置与价格只能从原冻结模型快照取得，不从工具请求读取。
