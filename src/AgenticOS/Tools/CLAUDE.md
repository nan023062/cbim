# Tools：内置动作与约束

## 职责边界

- 本模块把标准工具标识转换为进程内 `AIFunction`，提供文件、搜索和命令执行能力。
- 工具描述存储与工具实现分开：保存描述符不等于实现或安装一个工具。
- MCP 外部协议连接归 [Mcp](../Mcp/CLAUDE.md)，脑区权限与动态装配归 [运行时](../CLAUDE.md) 的 Brain。
- `ToolSandbox` 是应用层路径/限额配置，**不是操作系统级沙箱、容器或进程权限隔离**。

## 关键对象与契约

- `ToolDescriptor` 以 FamilyName 标识内置工具家族，并保存用途描述；不保存本次任务路径。
- `FileToolStore` 通过 FileBackend 保存 `<root>/tools/<familyName>.tool.json`，可自定义子目录。
- Store 的 Get/List/Put/Delete 管理描述索引与文件；实际可执行工具仍由 StandardTools 显式分支决定。
- [StandardTools.Build](Standard/StandardTools.cs) 接收 toolIds、ToolSandbox 和可选 FileBackend，返回扁平 AIFunction 列表。
- 单工具标识包括 readfile/writefile/editfile/deletefile/listdir/grep/glob/bash/run_command。
- 家族别名包括 files/search/shell/bash-all；标识忽略大小写，未知项跳过，产物按函数名去重保留首次。
- 输入标识不一定等于暴露给模型的函数名，例如 bash/run_command 对应 `RunCommand`。
- `CreateFamilies` 是废弃兼容入口；新调用应使用 Build。

## 路径约束与真实安全边界

- `ToolSandbox` 提供 AllowedPathPrefixes、WorkingDirectory、文件/结果上限、扩展名和主机配置字段。
- 工具绑定构造时的 sandbox；Brain 按调用重新创建实例，而不是复用并改写上次白名单。
- `PathGuard.Normalize` 要求非空绝对路径，使用 GetFullPath 折叠路径段，并按目录分隔符边界检查包含关系。
- 空白名单或越界路径拒绝；避免简单字符串前缀导致 `/foo` 错放行 `/foobar`。
- 路径比较在 Windows 上忽略大小写，其他平台按大小写比较。
- GetFullPath 不解析符号链接；白名单检查不等价于链接目标隔离，也不能替代宿主 ACL 等安全措施。
- 文件/搜索工具的约束取决于各实现调用 PathGuard 的位置，不能把字段存在当作全部工具已执行限制。
- 当前 Build 没有 Web 工具分支；WebAllowedHosts 字段不是已经交付的网络访问控制。

## 命令执行与副作用

- `BuildRunCommand` 在 Windows 启动 cmd.exe，在其他平台启动 /bin/sh；名为 bash 不代表固定使用 Bash。
- 显式 workDir 会先做路径校验；未传时使用 sandbox.WorkingDirectory。
- cwd 校验只约束起始目录，不检查 command 中的任意文件路径，也不限制子进程网络或系统权限。
- 因此不能宣称 shell 命令受到与文件工具相同的根目录隔离；需要更强隔离时必须由宿主实现。
- 工具执行带超时和输出采集，结果包含 exitCode/stdout/stderr/timedOut；文本错误也可能直接返回。
- `RunCommand` 在启动进程前记录 Kind 为 bash 的 SideEffect；有记录不等于进程启动成功或命令成功。
- 文件写入、编辑、删除也通过 sandbox 的 SideEffects 队列记录动作；队列是遥测，不是回滚日志。
- 文件工具通常让 UnauthorizedAccessException 上抛；RunCommand 的显式 workDir 越界返回 SandboxViolation 错误文本。

## Brain / Kernel 协作约束

- `Brain.RebuildMotorStandardToolsForInvocation` 用本次 Modules 的 WorkspaceRoot 构建白名单，首个根用作 cwd。
- Modules 为空或 ToolIds 为空时不装配标准工具；不要为了方便退回全工作区权限。
- Brain 合并标准工具与其他工具后调用 `Neuron.ReplaceTools`，调用结束后排空副作用队列并更新 NeuronOutcome。
- `ToolSandbox` 和 StandardTools 引用 Kernel.SideEffect，工具层并非完全独立于执行结果契约。
- 副作用结果格式见 [Kernel DNA](../Kernel/CLAUDE.md)，模块根来源见 [Workspace DNA](../Workspace/CLAUDE.md)。

## 源码与验证入口

- 工具路由和动作实现看 [StandardTools.cs](Standard/StandardTools.cs)，路径检查看 [PathGuard.cs](Standard/Sandbox/PathGuard.cs)。
- 配置和队列看 [ToolSandbox.cs](Standard/Sandbox/ToolSandbox.cs)，描述持久化看 [FileToolStore.cs](FileToolStore.cs)。
- [BashSideEffectTest](../../AgenticCLI/Test/BashSideEffectTest.cs) 验证 RunCommand 入队 bash 记录，不强求命令输出成功。
- 该测试不证明 OS 隔离、路径越界防护或所有文件动作正确；相关变更需分别核对错误和成功分支。
- 公共验证入口见 [源码 DNA](../../CLAUDE.md)；修改工具标识或参数时同步检查 Brain 装配及 AIFunction schema。
