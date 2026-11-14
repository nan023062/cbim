

## 知识参数默认值装配

loop-engine 仅对 KnowledgeTools.has 命中的当前注册知识工具提供 normalizeToolInput；通过 normalizeInput 校验绑定实例和实际 Schema，在 Runtime 记录请求前补齐身份与默认值。派发、岗位、原生及其它工具保持原输入和独立校验。执行服务仍重新核对同一实例与写权限，不借规范化提升授权。

### 执行选项中的模型角色

WorkspaceLoopOptions.modelRoles 仅表达 Agent 附加模型引用；实际入口在启动前通过 EngineModelProfiles 校验并冻结。当前代码引擎仅消费 primary，未声明角色不能穿透选型校验。

### 统一工厂切片

loop-engine 不直接选择具体构造器，也不解析 Pi SDK 路径；通过 engine-adapters 的源码兼容表取得已核协议的工厂。Pi 进程准备移到其 package.ts，SDK 版本核对保留。源码兼容表仅供开发运行；正式构建改用已验证 E，安装选择与独立更新管理另由包生命周期服务承担。

### 正式 E 加载

生产 build 通过 packagedEngineBuild 将源码兼容表替换为拒绝回退的入口；loop-engine 对受管包只调用 engine-package-loader，按冷宿主给出的不可变根、适配器入口、版本和协议核对。该动态加载登记实际源码依赖，不作为外部依赖豁免。开发直接运行源码时才使用兼容表。
