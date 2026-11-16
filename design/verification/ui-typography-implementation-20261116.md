# 统一字号与字重实施验收（2026-11-16）

关联 Issue：[#94](https://github.com/nan023062/cbim/issues/94)。基线：160a703c20eaec66a0cba5c6085a37ab9494b90e。实施依据：[审查报告](ui-typography-audit-20261115.md)。

## 实施范围

52 份 View 样式改为共享排版令牌，普通文字不再散落 9–15px 的局部尺寸。未改变 Logic、调度、权限或持久化行为。

|用途|默认值|规则|
|---|---|---|
|正文、菜单、输入、按钮、说明、状态、Tooltip|15px / 400|统一随界面字号 13/15/17 调整|
|结构短标题、选中重点|普通字号 / 500|不把整段用户目标加粗|
|页面标题 / 弹窗标题|20px / 18px，500|仅用于结构层级|
|代码、行内代码、等宽日志|14px / 400|独立选择 12/14/16，旧偏好保留|
|Markdown 内容标题与强调|保留语义|主 Agent 与执行 Agent 不另设缩小层级|

- ConversationTopics 的长目标从 h3/strong 改为普通 p/span。
- 普通流程说明与步骤负责人不再混用代码字号；履历的身份说明与代码分开。
- 删除执行 Agent Markdown 独立缩小覆盖。
- 外观设置明确“界面字号”和“代码字号”的实际作用范围；默认代码字号由 12 改为 14，不覆盖已有选择。
- 320px 外观选择改为逐行，账号说明重排；不靠减小字体适配空间。
- result_ready / interrupted 统一使用共享 warning 色，清理冲突定义。
- 同步 14 个受影响目录的 CONTRACT 与 ARCHITECTURE、52 份样式说明及 TSX/偏好字段注释。稳定业务机制没有被修改。

## 截图与证据

本地可打开 [单文件截图索引](../../test-results/typography-review.html)，包含 **276 张真实截图**；可按页面、light/dark、1440/390/320、bottom 筛选。图片内嵌，可离线携带；约 14.6 MB。哈希清单：[typography-manifest.json](../../test-results/typography-manifest.json)。

|范围|实际覆盖|证据|
|---|---|---|
|八类设置|模型、账号、外观、运行、预算、网页、资源、关于；明暗 × 1440/390/320，上下滚动位置|settings-center/type-*.png|
|其他页面组件|团队、业务架构、诊断、自动化、三类资源、运行总览、治理、负责人、岗位、履历、旧话题/频道/办公室、任务详情、Markdown、四类编辑器、帮助和聊天消息，共 23 类|typography-pages/*.png，results.json|
|完整主窗口|真实 App、侧栏、主消息流、工具调用、输入框；明暗 × 三宽度|full-conversation-*.png，app-results.json|
|递归 Agent|子调用、孙调用、只读详情、身份错误与重试；320px 无横向溢出|agent-call-mobile.png，agent-call-ui-report.json|
|引擎菜单|安装、更新进度、关闭重开、失败重试、减少动效|engine-menu-mobile.png，engine-menu-report.json|
|长弹窗|四类编辑器滚动到底部，“校验并预览”可见|editor-*-bottom.png|
|帮助与更新|实际打开弹窗，稳定帧；更新明暗 × 三宽度|help-*.png、full-help-open.png、settings-center/updates-*.png|
|字体偏好与放大|实际切换正文 17 / 代码 16、恢复 15；CSS 125%/150% 放大|appearance-large-zoom-*.png|

设置页 body 实测 15px/400，完整主对话正文与输入框实测 15px；页面宽度检查均未超过视口。组件目录无未处理渲染异常。设计复查逐页查看设置联系表、23 类浅色桌面/320px以及深色桌面联系表，并原图检查长目标、四类编辑器、主对话、工具和帮助。不是对所有截图逐字审阅。

修复过的截图问题：早期 Agent 脚本只加载 shell 样式，现改为应用完整 styles；早期帮助图片截到入场动画，现使用稳定帧重拍；完整主窗口主题切换等待过渡完成。最终索引使用重拍文件。

## 实际验证

按变更责任选择外观偏好、话题投影和界面专项；未无选择运行全仓单测。

- `pnpm exec vitest run tests/appearance-settings.test.ts`：9/9，通过；包含新默认值与旧代码字号 12 保留。
- `pnpm exec vitest run tests/conversation-topics.test.ts`：7/7，通过。
- `pnpm typecheck`：通过。
- `pnpm check:architecture`：通过，135 目录文档一致、0 循环、0 边界违规。
- `node scripts/typography-ui-smoke.mjs`：八类设置 48 组合通过，补滚动底部、更新与大字偏好截图。
- `node scripts/typography-pages-smoke.mjs`：23 类页面 138 组合通过。用 CBIM_UI_PAGES 对编辑器底部、帮助稳定帧补拍；不重复业务执行。
- `node scripts/typography-app-smoke.mjs`：完整 App 六组合通过，输入框/正文一致，无未预期 IPC 或页面异常。
- `node scripts/agent-call-ui-smoke.mjs`：四项通过，executionWrites=0。
- `node scripts/engine-menu-ui-smoke.mjs`：五项通过，pageErrors=[]。
- `node scripts/typography-gallery.mjs`：生成单文件索引与每张截图 SHA-256。
- `git diff --check`：通过。

## 验收边界

上述是 **Windows Edge 中真实 React 组件 + 隔离 IPC 夹具** 的排版验收，不是已安装 EXE 的桌面、真实模型、工程写入或安装升级验收。资源页覆盖空列表；治理、岗位、负责人和运行总览部分展示明确的来源不可用状态；没有覆盖这些页面的全部业务数据组合、审批动作或提交成功状态。旧频道和办公室仅验证历史界面的排版，不恢复旧派工实现。

窄屏主窗口沿用原有侧栏布局；本次统一文字，未重设计导航。原生 select 的长接口名称仍可能显示省略，展开可选择。未改动版本号、合并 PR 或公开发布。历史 CI 的业务失败不由本次排版验收消除。截图保存在工作目录 test-results，未将大体积图片加入 Git；保留生成脚本以便复现。
