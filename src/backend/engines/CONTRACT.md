# 受管引擎包与原生历史

具体适配器仍依赖 Core，调度装配选择适配器。EngineRuntimeResolver 由可信主进程注入，返回完整验证后的 root、entry、version、identity；不接受 renderer、模型或工作区提供下载路径。开发/CLI 未注入时保留原依赖解析方式。

Pi 的 CLI、Claude Agent SDK 和 Codex EXE 使用预编译依赖包；用户机器不执行 npm install 或原生编译。当前适配器继续固定 Pi 1.5.0、Claude 0.3.322、Codex 0.167.0，不能仅把远端 version 改为 latest 来升级。Codex 的本机文件工具仍显式依赖受管 Pi 包。

程序包与 agentHome 分离；模型账号、凭据和原生历史留在原用户目录。runtime-binding 在 session.bound 前同步保存原生 sessionId 对应的 E 摘要及辅助工具摘要。恢复前先核对；不同摘要不启动新 SDK/EXE 来尝试旧会话。旧整包没有旁路记录时只允许原固定版本迁移，今后提高适配器版本不得同步放宽 legacyVersions。

第一版对不兼容旧会话明确报错并要求新建对话，保留历史；尚未实现按旧会话自动选择旧 E 或跨 E 历史迁移。当前/旧 E 缓存不自动清理，也不把文件留存等同于已验证可恢复。新会话可以使用随新 R 选择的已验证 E。
