# 团队与项目组合 DNA

## 职责与边界

AgenticTeam 将多个 Cbim 实例组织为成员集合，并将团队与多个工作区路径组合为项目。它维护组织关系与实例生命周期，不实现脑区算法、任务规划或跨机器通信。

[AgenticTeam.csproj](AgenticTeam.csproj) 引用 AgenticOS，命名空间为 CBIMTeam。单成员内部仍保有完整 Session/Brain 结构；不能把多个脑区直接等同于多个团队成员。

## 关键对象与直接子结构

- [Team/TeamDescription.cs](Team/TeamDescription.cs)：TeamDescription 定义团队身份与 MemberDescriptions；同文件的 TeamMemberDescription 定义成员 ID、角色及 CbimOptions。
- [Team/AgenticTeam.cs](Team/AgenticTeam.cs)：创建、查询、增删成员和释放团队。
- [Team/TeamMember.cs](Team/TeamMember.cs)：持有成员专属 Cbim，Dispose 委托给该实例。
- [Project/AgenticProject.cs](Project/AgenticProject.cs)：持有 ProjectDescription、已有 Team 及 WorkspacePaths。
- [Project/ProjectDescription.cs](Project/ProjectDescription.cs)：项目配置数据，不是任务执行图。

## 成员管理契约

- `AgenticTeam.Create` 按成员描述逐个调用 Cbim.Create，建立 ID 到 TeamMember 的字典。
- `Members` 在锁内返回成员列表快照，不直接暴露内部字典。
- `GetMember` 对空白或未知 ID 返回 null；调用方不能假设一定有匹配成员。
- `AddMember` 创建新的 Cbim 并按 ID 写入成员字典；当前实现不是重复 ID 校验或事务式成员替换接口。
- `RemoveMember` 移除后释放成员；空白或不存在 ID 时不执行释放。
- `Dispose` 获取并清空成员快照，再逐个释放其 Cbim。

## 项目组合与资源所有权

`AgenticProject.Create(description, team)` 接受已创建的团队，并持有描述中的 WorkspacePaths。它没有把这些路径转换成可调度的跨机器工程，也没有按路径自动创建任务队列。

AgenticProject 当前 Dispose 为空，不会替调用方释放关联 Team。需要区分“持有关联对象”和“拥有其释放责任”，不能仅从 IDisposable 接口推断级联释放行为。

各成员 Cbim 的 RootPath、模型与 MCP 等选项由成员配置提供；团队层不自动分配独立文件目录，因此不能声称不同成员的持久化一定互相隔离。

## 依赖与修改约束

- 实际运行时能力由 [AgenticOS](../AgenticOS/CLAUDE.md) 提供；团队不应复制 Cbim 的会话或客户端管理逻辑。
- AgenticOS/Team 内的同名空壳类型不是这里的团队实现，定位时以本程序集的 CBIMTeam 类型为准。
- 改变成员添加、删除或项目释放语义时，应同步核对 TeamMember → Cbim 的资源所有权以及调用方假设。
- 项目引用关系不等于网络部署架构；当前代码没有实现远程成员发现、消息传输或跨机器任务分配。

## 验证入口与限制

共享构建/测试命令见 [源码 DNA](../CLAUDE.md)。现有 [测试项目](../AgenticCLI/Test/AgenticCLI.Test.csproj) 引用了本程序集，但已有两个测试针对核心回路和工具副作用，不覆盖成员生命周期、重复成员 ID 或项目/团队释放语义。不要将解决方案测试通过等同于团队行为已完整验证。
