# Cindy 对话组件移植

上游：https://github.com/makecindy/cindy/tree/56b6e9a914a66fe37b0652405d160623a8ab6184

直接移植并适配 ComposerCard.tsx、SendButton.tsx：保留卡片 props 契约、86px 内容布局、28px 按钮、原 SVG、按下动作身份保护。用 CBIM CSS 与中文文案替代 Tailwind、i18n、主题模块，去掉未接入的语音分支。授权与 NOTICE 随 docs/legal 一起打包。

ChatInput.tsx 的编辑器、附件、订阅模型、插件和远程设备强依赖 Cindy 宿主；本版通过 CBIM 适配器重建这些已支持的入口，不能称为 Cindy 整个应用或全部聊天能力的原封移植。附件支持文件/文件夹引用、文本摘录、链接、公开网页文本、已登记链接器定义。链接器引用不代表运行外部插件；二进制文件只引用路径，按格式调用工具读取。

权限映射为只读、逐次询问原生写入/命令、允许原生执行；知识写入仍由工作区单独授权。暂停是停止本轮生成并保留会话，后续消息继续原生会话，不冻结正在执行的进程。对话用时为各轮执行时间之和，不包含轮次之间空闲时间。

## 执行与消息渲染

## 侧边栏、消息外观与执行状态

继续对照同一 Cindy 源码版本的 SidebarTopNav、ChatBubble、chatChrome 和 WorkGroupBlock：导航使用 32px 圆角行；侧栏默认 260px，可拖动或用方向键调整，双击复位并持久化宽度。CBIM 的工作区健康摘要仍保留在第二行，自动化入口仍归工作区内部。

MessageCard 使用 15px / 1.6 正文排版，用户气泡为 12px 圆角和 16px 水平内边距，助手为无底色正文；消息时间和复制操作在悬停或键盘聚焦时显示。WorkStatus 从实际运行事件生成耗时、状态、操作计数和最新活动，展开后显示工具轨道。折叠只影响显示，不改变任务或权限。

默认对话权限为逐次询问，原生 write/edit/bash 工具立即进入模型工具清单；副作用调用由界面批准。只读和允许执行仍可手动选择。知识库 writeEnabled 只管理 .cbim，不阻断业务文件实现；空团队、模块、Workflow 也不阻止主 Agent 创建业务成果。根目录可使用非递归 ls，知识目录与根递归搜索仍受限制。

MarkdownMessage 采用 Cindy MarkdownRenderer 的 ReactMarkdown + remark-gfm + rehype-highlight 流水线，移植 repairStreamingMarkdown 纯函数；正文显示标题、列表、表格、代码高亮与复制，不直接输出 Markdown 标记。ToolActivity 合并工具生命周期，区分等待授权、执行中、成功、失败和拒绝，展开后保留证据。安全链接经 Electron 打开当前工作区文档或 HTTP(S) 链接。

运行循环沿用 Pi 的工具结果回注与继续生成，终态等待 agent_settled；中途工具完成、重试、上下文整理不当作整轮结束。工具进度与重试/压缩状态进入持久化日志并可回放。尚未移植 Cindy 的多引擎切换、跨设备协作、语音和富组件协议；不得将当前适配称为整个 Cindy 系统完全复刻。

验证使用隔离的确定性模型服务与真实打包 Pi 进程，连续调用 ls → write → bash，在磁盘生成 HTML 并以浏览器验证交互；这验证工具执行链路，不代表真实供应商模型的生成质量。

## 输入框与附件交互
输入卡片采用 32px 起步的自适应编辑区和 30px chip 工具栏，Enter 发送、Shift+Enter 换行。模型菜单支持搜索，权限菜单说明真实行为，支持方向键、Esc 和点击外部关闭；选择按工作区/页签在本机保留。运行中不能修改本轮模型或权限。

附件使用 56px 卡片，可预览已保存快照、移除、拖入系统文件/文件夹或粘贴具有真实文件路径的文件；准备期间阻止发送，错误保留已选附件。截图等没有磁盘路径的剪贴板图片仍需先保存；二进制附件仍仅提供路径引用，不宣称已完成视觉解析。菜单没有冒充尚未实现的计划模式、自动审批或远端上传服务。

Pi 运行设置另移植同版本 buildPiSettingsJsonContent 的重试参数与容量/预算分离公式；实现位于 src/backend/core/brain/pi/runtime-config.ts，启动、恢复应用 RPC 并读回。Apache-2.0 许可与原版权声明保留在 docs/legal。

计量布局参照同版本 RunningTokenRatePopover 与 runningTokenUsage：输入框上方用时/平均生成速度，底部任务价值与上下文环，点击查看明细。CBIM 使用原生消息计时和 getContextUsage，缺少可靠时间不显示 TPS；没有逐 token 采样时不伪造速度曲线。价格按 USD/百万 token 配置；未知价格留空，不以 0 费用冒充免费。
