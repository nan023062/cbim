

## 知识参数默认值装配

新 Agent 工具装配经 ExecutionServices.agentTools 明确提供；仅此路径使用统一主／执行指令并不装配旧派发工具。根 Agent 对象保留主会话已有可用知识、网页和反馈授权，子对象只获得冻结指令、同权限工具与递归能力。`WorkspaceLoop.agent` 给主执行管理器和子调度使用同一 AgentExecutionLoop 驱动。旧未装配入口保留原运行协议，不能仅依据角色名开启递归。

统一 Agent 工具列表不套用旧 Team 的业务工具过滤；工具可见性不提供授权，执行仍通过 Runtime 的本轮权限、审批和原服务写入检查。

loop-engine 仅对 KnowledgeTools.has 命中的当前注册知识工具提供 normalizeToolInput；通过 normalizeInput 校验绑定实例和实际 Schema，在 Runtime 记录请求前补齐身份与默认值。派发、岗位、原生及其它工具保持原输入和独立校验。执行服务仍重新核对同一实例与写权限，不借规范化提升授权。

## 冻结引擎与启动预检

createWorkspaceLoop 将模型与引擎配置核实后确定的 engine 作为 RuntimeOptions.engineKind 注入，主与成员装配均不能遗漏。该声明只用于运行受理前核实历史可转交性；实际适配器和周期工具仍在 beforeRun 之后创建。Runtime 会复核实际 kind 与声明一致，不能在预检后静默改换引擎。
