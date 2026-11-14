# 发布验收进程与 CI 调度改进验收

2026-11-14，用户要求落实发布复盘中的进程生命周期与无效全量运行问题，并重跑完整发布检查。仓库/账号为 nan023062/cbim / nan023062；基线 b8c2823565a2b72d7748e90b7eb564130d32fc91。无对应开放 Issue，不纳入 #65。完整变更、最终精确 head/base 的 CI 和合并回执统一见 [PR #76](https://github.com/nan023062/cbim/pull/76)。

## 改动与代码入口

- `scripts/desktop-acceptance-process.mjs`：`ownLaunchedDesktop` 从实际 Electron 读取 PID/EXE，拒绝将 Windows cmd 启动器当成桌面主进程。`DesktopAcceptanceProcess` 持有不可变 PID、连接、退出观察与唯一收尾 promise，统一普通退出、资源重启、安装交接；停止后禁止继续读取已释放连接，未知 UI 动作不重放。
- `scripts/desktop-acceptance-process.ps1`：观察真实进程句柄，在取 Path 前后核 HasExited；已退出的空路径不误报身份，活进程错误身份和超时仍失败。只读观察，不终止任何被测进程。
- `scripts/desktop-inspector-connection.mjs`：关闭时拒绝挂起求值并等待实际断开；主验收器对部分建立的连接、原生退出和首个异常分别收尾，保存 process-lifecycle.json。
- `.github/workflows/validate.yml` / `scripts/ci-scope.mjs`：草稿 opened/synchronize/reopened 暂缓正式检查，ready_for_review 重算当前 head/base；converted_to_draft 停止过时同 PR 检查。手动 full 保留，诊断与全量使用不同并发组。deferred 不进入正式汇总，不减少非草稿产品四片和覆盖验证。
- `.github/workflows/desktop-acceptance.yml`：安装前先运行六个相关工具套件；相同场景重复派发才去重。online 增加独立全新安装，再从实际旧版走线上升级；不创建测试 Release 或替换同版附件。

维护入口见 [发布进程说明](../task/desktop-release.md#验收进程与发布复验)、[CI 调度说明](../task/ci-validation.md)。三份 cbim-release Skill 内容一致。此次不改 src、依赖锁、版本、产品或安装制品，没有产品类图/契约改动。

## 开发验证与两次失败

本地初始进程/协议/输入/网络五套 80/80、CI 分流 35/35；随后增加 Windows 退出竞态以及真实 Electron/启动器身份回归。最新云端安装前置为 **六文件 83/83，0 跳过**。本地精确新增用例通过，模块登记 498 文件，依赖 1516 文件/0 循环/违规，脚本语法和 diff 空白检查通过。最终全量结果另以 PR 检查为准，不能由这些定向数字推算。

| 独立在线运行 | 结果及修正 |
| --- | --- |
| [43559662857](https://github.com/nan023062/cbim/actions/runs/43559662857) | 新前置与全新安装通过；资源 UI 重启时 PID 身份核验失败。原错误未记录 actualPath，增加真实 Windows 退出竞态回归及具体身份诊断。 |
| [43560388037](https://github.com/nan023062/cbim/actions/runs/43560388037) | 增强证据显示 actual 为 cmd.exe，确认读取了 Playwright 启动器 PID。前一竞态修复不是这次失败的已证实根因；改为读取实际 Electron 身份，增加真实空窗口进程回归。 |
| [43561143963](https://github.com/nan023062/cbim/actions/runs/43561143963) | **通过**。workflow head ecaef2ab1386f9e2f885d27a99064b7d9dd64bad；产品冻结源仍为 b21a77ec23f17089a80ec738bbe365f9c56e71d5。报告完成于 2026-11-14T05:26:40.681Z。 |

Windows 本地新增测试首次因 PowerShell 5.1 将无 BOM 中文注释按本地编码解析而失败，辅助脚本改为 ASCII 注释后通过；云端 PS7 同一回归通过。原始本机/云端失败报告全部保留，不以成功覆盖失败，也不把测试工具错误报告成产品升级缺陷。

## 当前制品的完整复验事实

本轮仍使用公开 C0.1.16/R1、Windows 未签名制品，资源 Ed25519 身份不变。安装器 SHA-256 为 `4ca66fdb13118b67c6e2f08891b9204fc854dc6dabfb2609c09fa182b670ef39`。没有重打包、移标签、替换附件或安装到用户生产环境。

- `pnpm verify:desktop build/desktop-release/0.1.16/unsigned-20261114-094902-d205c3b0 --unsigned`：原候选重新核验通过。`verify-cold-payload.ts <实际打包目录> <原 runtime 候选目录> --published-engines`：签名清单/冷包及三种固定公开 E 字节验证通过。
- 实际打包 EXE 的 `office-team-online-smoke.mts`：真实 DeepSeek deepseek-flash 主/成员协作、两个排队话题、目标审阅完成、同角色一个逻辑 Session、不同话题原生上下文隔离通过。时间 05:05:09Z–05:07:51Z；证据 `test-results/office-online-GmK0CD/report.json`。这与安装工作流的确定性模型验证分别记录。
- 实际打包 EXE 的 `isolated-node-smoke.mts`：文件、禁网、超时、取消、非零退出、输出上限六项通过。
- 成功在线运行先完成独立 fresh-user 安装，真实下载 Pi 1.5.0 并核对 15338 文件，完成一次确定性模型请求；另一 profile 从真实 0.1.15/R1 → R4 → 0.1.16/R1，实际 NotSigned、原 user/desktop 保持。
- 安装包 **10 个 Range、4683509 字节、0 全量回退**；缓存摘要正确，普通退出不安装，重开复用缓存且安装器请求为 0，真实 UI 点击后 NSIS 启动新版本。该字节数不含资源 R、索引和协议开销。
- 工作区、模型、原 completed 会话、localStorage、标记、知识、业务文件、主 Agent 配置、自动化十项保留/无重放均通过。总确定性模型请求 2（fresh 1、迁移 1），页面错误 0。
- process-lifecycle 保存七个实际 PID 的 active → stopping → closed，包含资源 UI 重启、安装 UI 交接与普通退出；没有 failed 或未完成的所有者。
- `ci-website-smoke.mjs`：320/390/1280 深浅色及独立页面共 14 场景，0 页面错误。2026-11-14T05:06:54.208Z 匿名下载四附件/六个官网文件，与原候选和本地构建逐一匹配摘要；Release ID 444935258、原标签源及旧 Python latest 327801733/v1.0.2 不变。官网没有改动，不重复部署。

本机原始证据目录 `test-results/release-tooling-20261114/`，包含三轮安装报告、前置结果、进程轨迹、原候选/公开校验、执行隔离和官网证据。线上报告可从上述运行的 artifact 取得。

## 减少无效全量运行的证据与边界

草稿的 [43559662100](https://github.com/nan023062/cbim/actions/runs/43559662100) 和 [43560391200](https://github.com/nan023062/cbim/actions/runs/43560391200) 均只实际执行 scope/deferred 两项；static、四片和正式汇总跳过。中间安装失败修复没有触发或取消完整四片。手动诊断隔离、Ready/converted_to_draft 触发及 fail-closed 汇总由 CI 配置与分流回归核对，不为演示并发取消而额外启动全量。

本记录在安装/模型/制品/官网通过后、最终完整 CI 前冻结。随后将 PR #76 标记 Ready，对最终提交运行正式四片/静态/完整发现全集验证；准确 run、测试数、既有跳过与合并回执在该 PR 统一回填，避免为填最终 SHA 再制造一次产品全量。此处已列出的证据不替代正式 CI，也不代表人工 review 已接受。
