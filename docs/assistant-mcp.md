# MCP 接口与发现

每个工作区在 127.0.0.1 分配独立端口，使用官方 TypeScript SDK 的 Streamable HTTP `/mcp`。正式 SDK Client 完成 initialize 与 workspace_identity 后才发布发现文件。

客户端调用 `src/main/discovery.ts` connectWorkspace：真实路径 → id → 用户根下 discovery.json → 检查 root/id/instanceId → credentials.json → 连接 → 再次核验身份。未运行不自动打开，过期实例要求重新发现。

发现字段包含 version、protocol、workspaceId、root、instanceId、pid、url、createdAt、credentialFile。PID 不是存活凭证。

必须携带 Bearer 读/写令牌，拒绝非 loopback Host 和携带 Origin 的浏览器请求。Agent 提交还需桌面本次运行开启写权限。MCP 不提供启动应用、打开工作区、设置写权限或任意 shell 操作。

| 工具 | 行为 |
|---|---|
| workspace_identity | 返回工程、路径、实例与运行状态 |
| knowledge_snapshot | 正式知识、版本、模块树、规则结果、Skill 继承 |
| knowledge_search | 路径和正文检索 |
| knowledge_preview | 校验变更并返回 diff 与影响，不写入 |
| knowledge_commit | 经版本、身份、权限和规则校验后事务提交 |
| knowledge_move_preview | from/to，to=null 删除，返回完整事务预览 |
| rules_validate | 启动确定性校验任务 |
| task_status / task_cancel | 查询或取消工作区任务 |

除 identity，工具都要求 workspaceId、instanceId。写入增加 revision、requestId、changes。changes 为 `[{path:'.cbim/…',text:'内容或 null'}]`，最多 1000 项；注册表由程序生成，不能直接编辑。requestId 为 8–100 位字母、数字、下划线或连字符。

工具失败返回 MCP isError 和 `{code,message,workspaceId}`，例如 CONFLICT、VALIDATION、STALE_INSTANCE、FORBIDDEN、PATH、RECOVERY、NOT_RUNNING。HTTP 401 是凭据错误，403 是 Host/Origin 错误，503 是关闭中。凭据不写日志。

HTTP 接收超时 30 秒，头超时 10 秒。长检查使用任务 id 查询/取消，提交期间不强杀；先完成或回滚再关闭连接。取消是协作式，不保证 CPU 检查即时抢占。工作区关闭不影响其他入口。

命令：`pnpm cli --root "<工程根>" --query "资源"` 或 `--validate`，测试可增加 `--user-data "<隔离根>"`。只连接已运行实例。
