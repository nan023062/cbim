# Kernel：执行与调度

## 职责边界

- 本模块提供脑区调用契约、Neuron 执行引擎、突触派发以及 Circuit 编译和执行。
- 脑区角色、工具权限、模型选择与调用路径切换由 `Mind.Brain` 负责，不在 Kernel 重新定义业务角色。
- `Neuron/` 封装模型工具循环；`Scheduler/Compiler/` 构建回路；`Scheduler/Orchestrator/` 将回路交给 MAF Workflow。
- 上层组合关系见 [运行时 DNA](../CLAUDE.md)，模块寻址见 [Workspace DNA](../Workspace/CLAUDE.md)。

## 关键对象与对外契约

- [NeuronOutcome.cs](Neuron/NeuronOutcome.cs) 同时定义 `NeuronInput`、`NeuronOutcome` 和 `SideEffect`。
- `NeuronInput` 携带 CorrelationId、Intent、StructuredInput、Context 和本次调用的活动 `Modules`。
- `NeuronOutcome` 区分 Summary、StructuredOutput、SideEffects 与 IsError/ErrorMessage，不用回复文本替代动作记录。
- `INeuron.InvokeAsync` 运行一次神经元调用；`UnderlyingAgent` 在标准 Neuron 上可用，外部实现返回 null。
- `IInvocable` 是调度目标入口，`IBrainLookup` 解析目标，`IPrefrontalCallback` 接收进度。
- `ICircuitExecutor.RunAsync` 接收回路、脑区查询器、回调及可选工具注册表和 Workspace。
- `NeuralCircuitBuilder.Commit` 校验并生成 `NeuralCircuit`；成功后 Builder 不再接受修改。

## 模型调用与实际依赖

- `NeuronFactory.Create` 根据 BrainDescriptor 选择 `Neuron` 或 `ExternalNeuron`。
- `Neuron` 使用 `FunctionInvokingChatClient` 包装 IChatClient，再构造 `ChatClientAgent` 执行模型和工具循环。
- Instructions 由 Soul、Identity、SystemPrompt 拼接；Skill/Workflow 等上下文通过 AIContextProvider 注入。
- `Neuron.InvokeAsync` 将 Intent 作为用户消息，流式文本和 token 用量回调给 Brain，汇总文本为 Summary。
- `ReplaceTools` 整体替换工具列表；调用方必须保留需要的 MCP、Memory、DNA、Compiler 等工具。
- Mind 与 Kernel 有双向类型联系：Brain 使用 Kernel 契约，Neuron/NeuronFactory/SynapseToolFactory 又引用 Brain。
- 这些关系位于同一程序集，不应把接口分离描述为当前内部类型依赖已经无环。

## 两条派发路径

- `SynapseToolFactory.Build` 为可调用脑区生成 `__brain_call_*` 工具，并拒绝重复 BrainId。
- 直接派发将 `moduleIdsJson` 交给 `ModuleResolver.Resolve`，得到活动 Module 后放入 `NeuronInput.Modules`。
- 编译派发将模块参数保存在 `CallBrainNode.ModuleIdsJson`，由 `BrainCallExecutor` 使用同一 Resolver 解析。
- 两条路径都必须传 Module；工作脑依此重建标准工具路径白名单，不能退化成整个工作区权限。
- 直接调用的 context 写入 `Context["ctx"]`；回路节点使用 `Context["previous"]` 传递上一摘要。

## Circuit 时序与稳定约束

- [Brain.ExecuteInvokeAsync](../Mind/Brain.cs) 在普通模型调用前创建 Builder，供 CompilerTools 收集节点和边。
- 本轮 `__circuit_commit` 只留下 Compiled；本轮仍返回 Neuron 结果，不立即追加执行回路。
- **下一次调用**发现 Compiled 后清空 Builder 引用，再交给 Orchestrator；未提交的 Builder 在本轮结束时丢弃。
- Builder 要求至少一个 Return、Return 从起点可达、图无环，并校验 Branch 出边；不要弱化提交检查。
- `Orchestrator` 通过 `CircuitToWorkflowCompiler` 和 `InProcessExecution` 驱动 MAF Workflow。
- 节点失败事件或缺少 Return 输出会形成错误结果；取消信号应继续沿调用链传播。
- 当前 Brain 调用执行器时传 `toolRegistry: null`，不能仅凭 CallToolNode 类型宣称工具节点已完整接入主链。
- Orchestrator 当前返回的顶层 SideEffects 为空；工作脑动作记录的收集发生在 Brain 的普通调用路径。
- `ExternalNeuron` 的 adapter 尚未装配；`Summarize` 历史压缩也没有实际 reducer，不能当作可用能力。

## 源码与验证入口

- 调用装配从 [Neuron.cs](Neuron/Neuron.cs)、[SynapseToolFactory.cs](Scheduler/SynapseToolFactory.cs) 进入。
- 回路从 [NeuralCircuitBuilder.cs](Scheduler/Compiler/NeuralCircuitBuilder.cs)、[Orchestrator.cs](Scheduler/Orchestrator/Orchestrator.cs) 进入。
- 当前没有产品测试项目验证编译回路把非空 Modules 传到目标脑区。
- 需补验证完整 Session 的“提交后下次执行”时序、两种派发路径及其错误分支。
- 公共验证命令见 [源码 DNA](../../CLAUDE.md)；定位本层回归时优先检查模块参数、提交时序和结果语义。
