# CBIM Assistant 0.1.5 发布验收

## 授权、范围与基线

- 用户要求三项需求全部完成后提交 PR、合并并发布新版本。范围为主 Agent 默认执行、Claude Code 和 Codex 三引擎、Agent/岗位/主对话引擎与模型菜单。
- 沿用已确定的个人开发阶段未签名发行选择（发布指南记录的 2026-11-09 用户决定）；不替换历史附件，之后签名迁移使用更高版本。
- 仓库及登录身份：nan023062/cbim、nan023062；默认 develop，稳定分支 master。开始时双方同为 fcb7774a，远端没有其他分支或开放 PR。
- 真实上一公开桌面版 0.1.4，Release ID 439619815；旧 Python latest ID 327801733 / v1.0.2 必须保持。
- 功能提交 a4472ecb。三个需求共享配置、工具与调度契约，合并为一个完整功能提交；已有开发测试的实际命令与边界见 Claude/Codex 专项记录及开发日志。

## 发布准备与验证

- 更新版本为 0.1.5，新增内置版本日志。0.1.4 延续 0.1.3 自动更新交互，验收输入新增明确枚举并保留未知版本拒绝；候选和公开升级均指定 previous_version=0.1.4。
- 新增定向验收输入回归，检查 0.1.4 → 0.1.5、同版拒绝和未知旧版拒绝。`pnpm exec vitest run tests/desktop-acceptance-inputs.test.mjs --reporter=default --reporter=json --outputFile=test-results/desktop-0.1.5-20261110/acceptance-inputs.json`：21 项通过；`pnpm check:brand` 与正式域名 `pnpm build:website` 通过（公开数据仍保持 0.1.4）。
- PR #30 的首轮完整 Windows 四片正在执行；候选安装、公开升级与官网分发尚未完成。

## 当前接续

冻结干净源码并构建唯一候选；通过完整 CI 与隔离安装后合并及公开，随后验证真实上一版 UI 升级，再同步既有 GitHub Pages 和双分支。

## 首轮候选与桌面专项

- 源码 91e61d564ec75ce609858d113dee74ad1cc5b078 构建 unsigned-20261110-131257-1609cc67，47 个 PE payload；构建完成且内部核验通过。该候选因协作模式提示仍描述旧默认执行者而退出发行候选，不上传公开渠道；保留原回执和日志。
- 修正 Auto/Team 说明，并同步 Conversation 文件头、CONTRACT 与目录类图。pnpm check:architecture 通过：55 目录/600 源码与样式、1185 文件/6101 含类型依赖、0 循环。pnpm typecheck 通过。
- 新增 scripts/multi-engine-ui-smoke.mts，显式指定同一真实 EXE 和独立用户目录。前两次失败为验收观察断言错误（Electron evaluate 参数、空草稿发送按钮禁用）；第三次为 Playwright 主进程观察 Promise 被回收，导致验收关闭取消了刚启动的 Codex。保留 initial/corrected/third 失败报告，未将取消冒充引擎失败或成功。
- 改用公开只读 IPC 查询真实运行后，engine-ui-public-read/report.json 通过：Pi → Claude Code → Codex → Pi → Codex → Codex，共 6 轮；各自原生文件复用、公开上下文接续、Team 主 Agent 实际写入、Agent 默认 Claude 与岗位独立 Codex、切换清空旧模型、禁用模型不出现、重启不重放。请求 Pi 2 / Claude 1 / Codex 4，页面错误 0。已审阅两张实际截图。
- 这是首轮包的功能证据；带提示修正的新冻结包仍须重新核验，并执行同包桌面/隔离平台冒烟和 NSIS 验收。本机确定性响应不证明在线模型质量。
