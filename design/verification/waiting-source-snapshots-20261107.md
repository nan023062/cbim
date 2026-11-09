# 安全等待的多来源资料快照验证

Step29 / R01，承接 `6276347`。状态：已完成本步实现、检查与最终 Windows 桌面验收。实施范围见[计划](../task/waiting-source-snapshots.md)。

## 已验证实现

Core 保留文件/图片 manifest v1 原结构，新来源采用严格 v2，并要求至少有一个新来源。Main 实际读取并生成来源事实：目录为最多 200 项的首层清单；链接仅保存 URL；网页为实际有界 HTTP 文本摘录；仓库为已授权 `resource_repository_v1` 七类静态正文。网页响应最多 1 MiB、摘录最多 64 KiB UTF-8，不跟随重定向、不执行脚本。仓库单次正文读取前后核授权、定义及共享代际，落盘后再次复核。

资料准备与目标受理分开。`importId` 对应一次准备及取消，先到取消保留墓碑，工作区退役和应用关闭撤销在途读取；原生系统对话框仍可能需用户关闭。已保存但未交付的孤立快照不声称回滚，也不自动进入模型。旧非文件记录缺少版本和来源证明时须重导，不根据旧 note 补造事实。

共享等待控制器核原等待和选择代次、在途锁及有序附件身份；迟到结果不进入新草稿。仓库分页固定实际来源与 revision。已受理历史明确展示链接指针、首层目录、摘录和当时授权，既不重新联网，也不声称当前源未变化。普通聊天草稿独立。

## 最终定向检查

- `pnpm typecheck` 退出 0。
- `pnpm check:architecture` 通过：51 目录、403 源码/样式、741 维护代码文件、3589 条含类型依赖、0 循环。实际类图差异为 0；中文注释和受影响 CONTRACT 已同步。
- 架构边界 `test-results/waiting-sources-boundaries-final.json`：2 文件 **13/13**。
- 最终组合 `test-results/waiting-sources-combined-final.json`：22 文件 **177/177**。包含新增 Core/Frontend/Main、真实混合来源 Pi、旧 v1 附件 Pi、原等待 Pi、运行内补充 Pi、人工接续 Pi、真实仓库 HTTP、队列和输入版本回归。本片未重复整个仓库测试。
- 真实来源测试覆盖目录超过 200 项且不递归、URL 零 fetch、有效 UTF-8 与不截断字符、无 Content-Length 累计超限、重定向/错误编码/类型拒绝、实际流式响应取消、原生选择迟到、仓库七种正文、撤权及共享代际变化、保存窗口撤权、坏来源与跨工作区拒绝。

初轮失败如实保留：Core 新夹具按 JSON 字符串比较键序及缺少 teamId；前端新夹具缺 provider/profileId 被正式请求 Schema 拒绝；并行新增的联合类型未缩窄导致类型错误。均修正夹具/类型后通过，没有放宽产品协议。前端初轮报告 `waiting-sources-view-initial.json` 与 `waiting-sources-view-verified.json` 失败；修正后 `waiting-sources-view-verified2.json` 26/26，最终组合再次通过。Core 初轮、Main 初轮证据也保留。

## 真实 Pi 证据

新增 `waiting-mixed-sources-{fixture,provider,pi.test}.ts`。使用真实 Application、Pi 子进程、工具、调度、候选和原生/canonical 存储，模型响应来自本机确定性 HTTP/SSE。正常与受理后丢回复各为主 13 / 成员 10 请求。

一轮完整 12 项：文本文件、PNG、目录清单、链接、网页，以及 connector/team/agent/skill/architecture/module/workflow 七类仓库正文。链接 0 次 HTTP，网页 1 次 GET，仓库目录与七份正文共 8 次真实 HTTP。随后改删源文件、修改目录、停止网页服务、改变仓库并撤销授权和共享，显式继续只用原私有快照，没有额外 HTTP；主重规划后派新成员取得实际证据完成。

四项 Pi 测试同时覆盖实际受理后丢一次回包、旧定义/跨区坏快照/无授权或旧代际预拒，以及真实网页读取取消。受理后原命令查询保持一次消费，原生用户资料与图片只附加一次。全部真实主/成员运行具有非空原生身份，重开比较 canonical/native 原字节且没有模型重放；正式知识内容没有被资料导入改变。最终结果纳入 177/177。

## Windows 打包与桌面验收

初包 **20261107-204732** 的 normal / unknown 通过：各主 13 / 成员 10 请求，12 项资料、真实系统选择器、普通草稿保留及重开无重放。独立切换会话测试随后发现真实缺陷：外壳仅隐藏旧 Conversation，未卸载也未变等待身份，旧网页读取仍完成并加入旧草稿。失败证据保留在 `test-results/waiting-mixed-sources-initial-204732/`；不以新草稿没污染掩盖原导入未取消。

修复让外壳 `active` 参与补充目标与选择代次，隐藏时撤销原 importId，切回不复活旧导入；不取消已受理继续。修后类型检查、26 项界面/控制器回归通过，架构仍无循环。固定最终包 **20261107-210415** 的 `pnpm make` 退出 0，`build/latest-build.json` 为 `stage: make`；程序为 `build/20261107-210415/CBIM Assistant-win32-x64/CBIM.exe`。

最终包三场通过：

| 场景 | 实际请求与结果 |
| --- | --- |
| 隐藏会话时取消导入 | 主 6 / 成员 5，真实网页 GET 1；原 importId 的取消仅 1 次，返回 `ATTACHMENT_IMPORT_CANCELLED`，两个草稿都没有新增附件、没有保存快照；等待、图及 2 主/1 成员日志字节不变 |
| 完整资料继续 | 主 13 / 成员 10，网页 GET 2（一次显式取消、一次成功），仓库 HTTP 8，URL 指针 HTTP 0；12 项进入实际续跑，原生用户图片只追加一次 |
| 已受理后丢一次界面回复 | 主 13 / 成员 10，网页 GET 1、仓库 HTTP 8、URL HTTP 0；原命令真实受理一次，冻结请求只查原回执，没有重复继续或导入 |

完整与未知两场各使用 3 次真实 Windows 系统选择器，分别选择普通附件、补充文本/PNG、补充目录；未替换原生对话框。12 项清单为文件 2、目录 1、URL 1、网页 1、七种仓库资料各 1。源文件/目录改变或移除、网页停止、仓库改变并撤权/停止共享后继续仍只使用原快照。两卡共享补充资料，普通聊天草稿和附件保留。

两场重开均展开已受理历史，核对 12 项名称、字节、来源类型及 7 种仓库资源的 ID/版本；实际截图已目检。重开无模型/HTTP 重放，也未自动重新共享仓库；4 主/2 成员 canonical/native 身份与原字节不变。三场页面和传输错误均为 0，自有测试进程和成功场次目录已关闭/清理。报告为 `waiting-mixed-sources-{complete,unknown,switch}-ui-smoke.json`；截图包括 `-history.png`、`-history-resources.png`、`-unknown.png`、`-restored.png`。

最终包首次完整场次在新增历史断言处失败：脚本预期“没有递归读取文件正文”，真实文案是“没有递归读取文件内容”；核实组件后精确修正脚本，同包重跑通过，未改产品适应测试。失败 JSON/截图及该次 `KqohQH` 临时目录、初包切换失败 `seVKUR` 目录保留。最终脚本独立严格类型通过；隐藏修复后的边界报告 `waiting-sources-hidden-boundaries-final.json` 13/13，控制器报告 `waiting-sources-hidden-view-final.json` 26/26。未把初包正常通过当作修后最终包验收。

同步维护 Core tasks、Main 装配/IPC/附件持久化/资源、Bridge、Frontend conversation/tasks 的中文注释，13 份 `ARCHITECTURE.md` 与 8 份 `CONTRACT.md`。

## 能力边界

目录不是全目录内容或完整产物清单；网页只处理 UTF-8 文本/HTML/JSON，不是渲染浏览器。静态仓库资料不是安装、应用或插件执行，保存快照也不延续当前联网授权。取消后已经落盘的孤立快照不自动删除。应用内导入/取消身份表有界为 4096 个，达到上限明确要求正常重开，不悄悄淘汰取消墓碑。

本机确定性模型只用于复现调度和来源链路，不证明在线自主规划质量或供应商计费。现有路径检查和 HTTP 边界不冒充操作系统网络/执行隔离。真实登录、服务器建设、发布签名和跨物理电脑试运行仍属于暂缓的第 9 组。
