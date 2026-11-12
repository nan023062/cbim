# CBIM 0.1.10（A）正式发布验收

日期：2026-11-12。用户授权先正式发布 A，再发布 B，完成完整 CI、隔离安装和公开升级验收。沿用已确认的未签名个人发行；不操作开发者已安装客户端。主工作区的并行架构调整未纳入冻结候选。

## 冻结与校验

- 构建源码：`09b63afb970a0a656504c1d1e18a647e56e5288d`；候选为 `build/a10/build/desktop-release/0.1.10/unsigned-20261112-110646-8f86a19f/`。
- 验证 head：`5f95e964601157dbd426bb1fed718f0a31feb330`，base：`c46ea7e7526a053d43e08477b77e201d7aa50e30`。
- [PR #51](https://github.com/nan023062/cbim/pull/51) 正常 merge：`b1b20a0f624a00265933fe69efc606f60f79e985`，未绕过检查或 squash。
- 产品源码、版本/依赖、构建配置、品牌、安装器及本版内置日志与冻结源码一致；24 项 Builtins 运行资料正文一致。Forge 复制的维护文档保留构建时快照，不宣称整个 resources 与后续仓库逐字节相同。
- 原始构建、六项准确打包 EXE 隔离验收和源码单元范围见 [A 制品记录](desktop-update-a-0.1.10-20261112.md)。公开前再次执行 `pnpm verify:desktop <同一候选> --unsigned` 通过。

## CI 与候选安装

[完整 CI 43151533521](https://github.com/nan023062/cbim/actions/runs/43151533521) 的四片均通过类型、架构、品牌、官网及完整单元切片：408 文件，2776 项，2774 通过、0 失败、2 跳过。两个既有跳过需要固定历史 EXE：owner-execution-legacy 的 pre-owner 数据、knowledge-source-lifecycle-application 的 pre-source 数据；未用新包代替。

[候选安装 43152245247](https://github.com/nan023062/cbim/actions/runs/43152245247)，attempt 1，workflow 为同一验证 head。干净 Windows runner 全新安装及真实 0.1.9 → A 覆盖安装通过；isPackaged=true，NotSigned，工作区、模型、同一 completed task/run、localStorage、标记、知识及版本、业务文件、主 Agent 选型/修订与自动化定义保留；无重复业务，模型请求 1 次，零页面错误。

## 公开回执

Release ID 442478935，公开时间 `2026-11-12T04:13:40Z`；[desktop-v0.1.10](https://github.com/nan023062/cbim/releases/tag/desktop-v0.1.10)，draft=false、prerelease=false、make_latest=false，标签指向冻结源码。旧 Python latest 保持 327801733 / v1.0.2。

| 附件 | Asset ID | 字节数 | SHA-256 |
| --- | --- | --- | --- |
| CBIM-Setup-0.1.10-x64.exe | 737984934 | 391408787 | `ed9a5b3e2c3d95bf909a03b27f6108d40db62ff44e27662189474e014a8fb15e` |
| CBIM-Setup-0.1.10-x64.exe.blockmap | 737987552 | 407724 | `0423edca0806aa36d816e1928c3b5eb054b6fc438fcd0934d9d8bb20fd5d74b4` |
| latest.yml | 737987743 | 348 | `e1bd71ac1e329f706b8c2b2534a32f9c52959aa71d66d06ae9a8b21bdab26f00` |
| SHA256SUMS.txt | 737987899 | 270 | `17dc71984af40321015ccfd3814e0951494413daa9d282a7fc0f6c1b9f678ecc` |

匿名 latest.yml、SHA256SUMS.txt 与冻结文件字节一致；没有替换旧发布附件。

## 公开升级与官网

[0.1.9 → A 在线验收 43153427566](https://github.com/nan023062/cbim/actions/runs/43153427566) 已派发，结果在后续收尾中追加；当前段落不将派发当作通过。官网快照已依据公开 A 回执更新，将随下一次正常 master 合并部署。

## 启动弹窗调查

用户截图的 ERR_FAILED (-2) 指向 A 的打包测试目录。2026-11-12 独立试验中，A 和 B 等待用户菜单就绪后正常启动/退出，零启动/页面错误；A 在 firstWindow 后提前 close 则复现相同报错。测试关闭发生在异步 loadFile 完成前，触发启动失败弹窗。正式安装验收等待界面就绪，已成功通过；没有据此修改或重打冻结产品包。诊断脚本只在自有测试进程捕获弹窗，不绕过正式验收。

原始证据：`test-results/release-ab-20261112/`，含 journal.jsonl、四片 JSON、候选安装报告、启动复现、冻结输入对比和匿名回执。安装过程仍使用原 NSIS；本次下载优化不承诺安装器本身变轻。

官网本机品牌检查、构建与 14 场景通过（320/390/1280 px、深浅色、两份独立离线页），零溢出/页面错误；线上部署尚待 master 合并。
