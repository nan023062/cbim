# 命令行宿主 DNA

## 职责与边界

AgenticCLI 是 AgenticOS 的薄命令行宿主，负责解析参数、合并配置、装配运行时并呈现结果。当前只提供一次性 `chat`，不是交互 REPL、常驻服务或桌面 UI；不在宿主重复实现脑区与调度逻辑。

程序集名为 cbim。[AgenticCLI.csproj](AgenticCLI.csproj) 同时引用 AgenticOS 和 AgenticTeam，但当前 chat 主链直接创建 Cbim，并不自动建立团队。

## 输入、输出与生命周期契约

[Program.cs](Program.cs) 的 Main 注册 chat，RunChatAsync 执行下列过程：

1. 读取 JSON 配置并应用 CLI 覆盖，解析 Provider。
2. 创建 AgentDescription 与 Cbim，显式注入真实 McpClientStarter。
3. 写入 ModelDescriptor，打开 Session，并订阅进度输出。
4. 发送一条消息，输出结果，关闭 Session；using 负责 Cbim 释放。

`--message/-m` 必填；其余输入包括 `--root`、`--config/-c`、`--provider`、`--model`、`--api-key`、`--soul` 和 `--identity`。

显式解析到无效 Provider 时返回 2；SendAsync 捕获异常或错误 SessionOutcome 时返回 1，成功返回 0。不要据此声称所有初始化异常都已被统一捕获。

## 配置与副作用

- 优先级为 CLI 参数 → JSON → 内置默认。API key 未显式提供时由模型层解析对应环境变量。
- 默认配置从 AppContext.BaseDirectory 加载；项目文件将 [appsettings.json](appsettings.json) 复制到输出目录，不能假设它总从当前目录加载。
- 默认 Provider/模型为 OpenAI / gpt-4o-mini；支持列表与实际可用性见 [模型模块](../AgenticOS/LlmClient/CLAUDE.md)，帮助列出不代表 builder 已实现。
- 默认 root 是系统 LocalApplicationData 下的 CBIM，`--root` 可覆盖；该路径兼作数据目录和 Workspace 根，不默认使用当前仓库。
- 运行会写入模型配置并发出真实模型请求，不是只读检查。默认 AgentDescription 未提供额外 WorkBrains，不能将此演示视为完整编程工作脑团队。

## 运行与验证入口

以下命令从 `src/` 执行；共享构建步骤见 [源码 DNA](../CLAUDE.md)。聊天前需在环境中提供 OPENAI_API_KEY。

```sh
dotnet run --project AgenticCLI/AgenticCLI.csproj -- chat --message "你好"
```

当前没有 CLI 产品测试覆盖；参数解析、配置优先级、退出行为和真实聊天仍需分别验证。产品测试现状与共享命令的限制见 [源码 DNA](../CLAUDE.md)。

## 修改约束

配置解析和输出留在宿主；可复用运行时行为放在所属核心模块。改变参数、默认路径或退出行为时，核对 Program、appsettings、项目文件之间的对应关系。
