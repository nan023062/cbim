# 主 Agent 设置

当前仅保留 MainAgentSettings，拥有工作区主 Agent 的选型 revision 与保存队列。通过 [Logic 模型服务](../../../logic/models/service/CONTRACT.md) 公开入口组合 LlmProfiles，后者拥有模型身份与配置短锁。

configure 先核对工作区实例和 revision，再在模型配置短锁内写入新 revision；写盘成功才返回结果。read 不解密或启动执行。两处界面读取同一份设置，已捕获的运行快照不被新设置热替换。

本模块组合 core/utility 的 SerialQueue 和 core/platform/node/files 的原子替换；每个实例独立，失败不阻断后续任务。主 Agent 设置依赖旧 team 契约，因此本批保留原位置，不能让新 Logic 反向依赖它。
