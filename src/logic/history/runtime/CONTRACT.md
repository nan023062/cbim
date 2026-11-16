
## 新递归运行归档

AgentHistoryService 在 run.started 核对 agent-tools-v1 与原父引用，允许业务成员绑定来自 loop 日志。索引保存原 agentCall；增量、恢复和详情读取都不得更换引用。旧 member 日志不接受新引用，缺协议或错身份仍显示诊断，不通过改目录或重放补齐。列表依旧仅读索引，正文依旧按原 journal/task/run 读取。
