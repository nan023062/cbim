
### 多角色模型采纳

岗位预览调用 EngineModelProfiles 一次捕获 primary 与全部附加角色，公开快照和选型一起保存；变化检测包含角色引用，额外角色改变须重新采纳，不能沿用旧配置指纹。

main-workspace-member-tools 依赖 execution 的 MainToolContext，不再依赖 AutoCollaboration 类型。新主调用与旧主批次都可提供已受理身份，岗位提交仍绑定原 actor 与 commandId，保留来源采纳、明确模型配置和停止排空规则。
