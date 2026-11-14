

## 知识参数默认值装配

loop-engine 仅对 KnowledgeTools.has 命中的当前注册知识工具提供 normalizeToolInput；通过 normalizeInput 校验绑定实例和实际 Schema，在 Runtime 记录请求前补齐身份与默认值。派发、岗位、原生及其它工具保持原输入和独立校验。执行服务仍重新核对同一实例与写权限，不借规范化提升授权。

### 执行选项中的模型角色

WorkspaceLoopOptions.modelRoles 仅表达 Agent 附加模型引用；实际入口在启动前通过 EngineModelProfiles 校验并冻结。当前代码引擎仅消费 primary，未声明角色不能穿透选型校验。
