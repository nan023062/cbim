# 主 Agent 设置

MainAgentSettings，拥有工作区主 Agent 的选型 revision 与保存队列。通过 [引擎选型服务](../../engines/CONTRACT.md) 组合 EngineModelProfiles；该服务将引擎策略投影为模型需求，底层 LlmProfiles 仍独占模型身份、设置队列与配置短锁。

configure 先核对工作区实例和 revision，再在模型配置短锁内写入新 revision；写盘成功才返回结果。read 不解密或启动执行。两处界面读取同一份设置，已捕获的运行快照不被新设置热替换。

本模块组合 core/utility 的 SerialQueue 和 core/platform/node/files 的原子替换；每个实例独立，失败不阻断后续任务。选型契约由同域 rules/agent-runtime.ts 定义；本模块属于 Logic 的团队配置服务，不依赖 Bridge 或 View。
