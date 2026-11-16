# 工作区诊断

WorkspaceDiagnostics 显示工作区身份、目录、实例和知识修订。只有 workspaceId 与 instanceId 都匹配的 Snapshot 才用于知识结果；其它快照不展示为已通过。运行未就绪时明确不能重新检查。结构检查无问题不代表业务语义或任务验收通过。只读刷新不修复或启动项目。


## 统一排版（2026-11-16）

普通文字、按钮、状态和说明复用 components/interface.css 的 --font-ui 与 --weight-regular；结构短标题使用 --weight-medium。颜色和间距承担次要信息层级，不把说明文字缩小。代码使用 --font-code，真实 Markdown 标题保留语义层级。
