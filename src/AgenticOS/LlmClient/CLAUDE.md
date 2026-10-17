# LlmClient：模型客户端适配

## 职责边界

- 本模块定义模型配置、配置存储、Provider 路由、凭据解析，并把模型描述转换为 IChatClient。
- 不负责脑区身份、工具循环、上下文压缩或跨脑区派发；这些归 Brain 与 [Kernel](../Kernel/CLAUDE.md)。
- 模型客户端的宿主装配关系见 [运行时 DNA](../CLAUDE.md)。

## 关键对象与对外契约

- `ModelDescriptor` 保存 Id、Name、Provider、ModelName，以及可选 ApiKey、Endpoint、Temperature、MaxTokens。
- Id 是配置寻址键，供 BrainDescriptor.ModelId 引用；ModelName 是发送给提供商的模型/部署标识。
- `FileModelStore` 保存 `<root>/models/<id>.model.json`，可覆盖子目录；构造时扫描，Put/Delete 同步更新。
- [ChatClientFactory.Create](ChatClientFactory.cs) 要求非 null ModelDescriptor，按 Provider 找 builder，再调用 Build。
- `ProviderRegistry.Register` 注册或替换 KnownProvider 对应实现；Resolve 对未注册值抛 NotSupportedException。
- `IProviderClientBuilder.Build` 是自定义适配边界，输出 Microsoft.Extensions.AI.IChatClient。
- 工厂不等于模型路由决策器，不替调用方补齐不存在的模型描述或自动故障切换。

## 已实现与占位实现

- `ProviderRegistry.CreateDefault` 先以 OpenAICompatibleBuilder 注册枚举值，再覆盖专用和占位 provider。
- `OpenAICompatibleBuilder` 使用 OpenAI SDK 创建 ChatClient，并通过 AsIChatClient 返回统一接口。
- `AnthropicBuilder` 使用 AnthropicClient 和对应 AsIChatClient 桥接，是实际实现而非占位类。
- **AzureOpenAIBuilder 和 OllamaBuilder 仍直接抛 NotImplementedException，注册不代表可用。**
- Ernie、Hunyuan、Spark 路由到 StubProviderBuilder，不能把 KnownProvider 枚举清单当作已验证支持矩阵。
- OpenAI 兼容路由共享适配器，不意味着所有提供商端点、模型和工具调用差异已做端到端验证。
- 实际依赖在 [AgenticOS.csproj](../AgenticOS.csproj) 中声明；旧 asmdef/DLL 注释不是当前项目配置依据。

## 凭据与端点规则

- `ApiKeyResolver.Resolve` 优先取 ModelDescriptor.ApiKey，再按 KnownProvider 的环境变量映射读取。
- 两处都无有效值时抛 InvalidOperationException；不静默使用占位密钥，也不扫描其他凭据文件。
- OpenAICompatibleBuilder 的 Endpoint 优先级是描述符值、KnownProvider 默认端点表、SDK 内置默认端点。
- 不要将 Endpoint 规则误写为通用环境变量回退；ApiKey 与 Endpoint 的解析逻辑不同。
- AnthropicBuilder 当前只使用 ApiKey 和 ModelName，不使用 ModelDescriptor.Endpoint。
- 若需其他 Anthropic 接入变体或自定义端点，必须实现并注册对应 builder，不能仅填写未消费字段。
- FileModelStore 会序列化 ApiKey；敏感部署宜使用环境变量，不把密钥写进示例、日志或版本库。

## 参数传递与实际协作

- Brain/会话装配侧解析模型配置后调用工厂；工厂只构建客户端，不创建 Neuron 或工具集合。
- Neuron 另行使用 FunctionInvokingChatClient 包装返回值，工具调用和流式输出逻辑不放入 provider builder。
- 当前两个实际 builder 没有把 Temperature/MaxTokens 应用为 ChatOptions 默认值。
- `Neuron` 构造 ChatOptions 时主要配置 Instructions/Tools；不能声称描述符采样参数已自动生效。
- 若扩展参数传递，应明确在哪一层映射到 ChatOptions，并检查不同 Provider 对字段的支持。
- `ChatClientFactory(ProviderRegistry)` 支持注入自定义注册表，便于验证路由而不调用真实模型服务。
- 返回客户端的使用和释放由上层 Neuron/宿主生命周期承接，不由 FileModelStore 管理。

## 稳定约束与验证入口

- 供应商枚举、序列化值、默认端点和环境变量映射变更需一起检查，避免已有模型文件失效。
- 不依赖源码注释中的示例模型名断言当前服务可用；真实服务能力需独立验证。
- 配置入口看 [ModelDescriptor.cs](ModelDescriptor.cs)、[FileModelStore.cs](FileModelStore.cs)、[KnownProviders.cs](KnownProviders.cs)。
- 路由与密钥看 [ProviderRegistry.cs](ProviderRegistry.cs)、[ApiKeyResolver.cs](ApiKeyResolver.cs)。
- 实际适配看 [OpenAICompatibleBuilder.cs](Providers/OpenAICompatibleBuilder.cs)、[AnthropicBuilder.cs](Providers/AnthropicBuilder.cs)。
- 当前 CLI 测试目录没有 Provider 专项测试；MockChatClient 是执行层替身，不证明网络鉴权或模型兼容性。
- 后续验证应区分纯路由/缺失密钥/占位异常检查与需凭据的服务调用，避免把前者当端到端结果。
- 公共验证入口见 [源码 DNA](../../CLAUDE.md)；添加 Provider 时同时补齐实现、注册和配置语义。
