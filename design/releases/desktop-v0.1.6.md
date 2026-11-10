# CBIM Assistant 0.1.6

本版为 Windows x64 未签名个人开发发行版。Windows 可能显示未知发布者或 SmartScreen 提示；请核实下载来源。后续签名发行使用更高版本。

## 修复

- Pi、Claude Code、Codex 三个执行引擎始终提供，不再因供应商未声明引擎而隐藏。
- 供应商只维护连接与统一模型列表；不再要求按引擎重复配置供应商。同一个模型可以被多个兼容引擎选择。
- 对话栏的引擎、模型选择就是主 Agent 配置，与团队页面“主 Agent 配置”双向同步，其他主对话和重启后保持一致。
- 自定义 Agent 和项目岗位独立保存执行引擎。只改变引擎也可生效；旧岗位、历史原生会话及已受理运行快照保持可核实。

## 使用与边界

- 模型列表按真实接口兼容性筛选：Pi 支持 OpenAI Chat Completions、OpenAI Responses 和 Anthropic Messages；Claude Code 支持 Anthropic Messages；Codex 支持 OpenAI Responses。不按模型名称猜测接口，也不伪装跨协议转换。
- 没有兼容模型时仍可选择引擎，界面提示补全模型选择并禁止发送；不会静默改用另一个引擎。
- 配置变更用于新执行；已启动和已排队的任务保留原选型。Claude Code/Codex 仍支持排队，暂不支持运行中插入。
- 0.1.3～0.1.5 的“下载更新”会自动校验、排空并安装重启；普通退出取消未开始的安装。旧版本按照其原界面操作。
