# C 0.1.15 / R4 发布记录

2026-11-13 用户明确要求“提交 PR 发布”。本次按已提交修复生成 R4，保持固定冷壳及三个 E，不操作本机正在使用的安装版。

## 范围与基线

- 仓库/账号：nan023062/cbim / nan023062，默认 develop、稳定 master。开始时无开放 PR；master 为 `bf63b3a99183330431ad91ca846b104336e964c2`，develop 为 `10d1f0f9755e138c29d3de9fec036424de8b1194`。
- 本次范围：#65 的七项独立修复 `e5989abd`、`4bfc2b39`、`8061ae74`、`465f94a9`、`30d264dc`、`4a87768c`、`10d1f0f9`。各步单元、类型、架构和界面验证见开发记录；这些证据不代替本轮完整 CI/升级验收。#65 未解决项不自动关闭。
- 当前公开安装包 C 0.1.15、资源 R3；资源通道 Release ID `442909771`，旧 Python latest `327801733 / v1.0.2`。不移动既有标签，不替换冷包、引擎或历史 ZIP。
- 资源基线为已验收 `build/runtime/c0.1.15-r3-Om0pQp`；原 Ed25519 私钥可用且公钥匹配已安装 C。固定冷指纹 `1bbb10bf276fad5bb811872d62f0f472bda0249a592db2a43c202a7c2a9cdc47`。Windows 安装包保持既有未签名模式，R4 清单仍签名。
- 原工作树存在未提交的任务历史折叠前端修改，本轮不纳入。冻结提交后在独立干净 worktree 构建；测试安装只使用隔离 Windows runner。

## 本轮证据

首轮候选冻结于 `a98b5436fbf23037c77f33c9743680354f78c02a`，PR [#66](https://github.com/nan023062/cbim/pull/66)。资源 ZIP `resources-c0.1.15-r4-win32-x64-55e5efb0e5bade2e84c1d55731aa7b6936ba3cafdb89abeb665308a0dadd0168.zip` 为 3902261 字节；payload digest `44ef6301a9914cbd72bee5c19ac2ba41fc875c27b5d390201c48d6ab9c7925f9`。原签名和 C/E 一致，`pnpm verify:runtime` 验证通过。构建终端因 PowerShell 将 Vite 警告当异常提前返回，但实际构建子进程完成；核实无在途构建、真实制品存在并验证后继续，未重复打包。

草稿 `runtime-c0.1.15-r4-candidate` / Release ID `443917835` 已上传三附件并回读摘要。完整 CI [43382151440](https://github.com/nan023062/cbim/actions/runs/43382151440) 四片共发现 37 个失败，未合并、未投放，也未将该候选送入安装验收。原候选和失败日志保留作为证据。

失败核实包括：继承未启动待办后忽略当前 blocked/awaiting_user 决定的调度漏洞；先前候选审阅/等待续接/错误结构更新后的消费者测试未同步；长对话测试把原生摘要请求误归类为成员重放。修正保留新行为及断言，依赖测试显式调用真实候选审阅入口，再验证原后继首次执行；不会通过放宽生产门禁或跳过测试来发布。

该失败发生后需要重新冻结产品源码并生成第二候选；验收器允许受约束的数字候选后缀，旧草稿与附件不覆盖。当时未进行候选安装、合并或公开；下文逐项记录后续真实结果，不复用旧 R3 成功记录。

原始证据保存在 `test-results/release-r4/`。现有验收器实际覆盖 C 0.1.15 / R1 → R4，使用 localhost 确定性模型检查数据保留与无重放；不据此宣称从 R3 起点或用户线上模型已验收。

## 第二冻结候选与安装验收

- 冻结 source：`ae6deee959cec22db2daff8abc75aa90439e7825`。候选目录 `build/release-r4-source/build/runtime/c0.1.15-r4-B5kpQx`，创建时间 `2026-11-13T07:30:10.173Z`。
- ZIP：`resources-c0.1.15-r4-win32-x64-4ee98b17668354291e0b565a636c8dee7c36170ab922fcca180a91d5eb7832c4.zip`，3904698 字节；payload digest `0689c8595085967921937d439ef29135defd36e29a353d2134bff2027b1898ec`；latest.json 文件摘要 `4ff9b4025fecadd352bdfd509a2300adab33e7726d0bd34c4bf96f2a8904e018`。
- `pnpm make:resources ../runtime/c0.1.15-r3-Om0pQp 4 design/releases/runtime-c0.1.15-r4.md` 和 `pnpm verify:runtime build/runtime/c0.1.15-r4-B5kpQx` 均成功。C 冷指纹和三 E 身份保持原值。
- 第二草稿 `runtime-c0.1.15-r4-candidate-2` / ID `443941606`，target 与 source 一致；三个附件的 uploaded 状态、长度和 SHA256 均已回读。首轮草稿未覆盖。
- 隔离候选验收 [43387124145](https://github.com/nan023062/cbim/actions/runs/43387124145) 成功，报告 source/digest 与本候选一致，完成于 `2026-11-13T07:40:23.530Z`。真实安装 C 0.1.15 / R1，使用签名候选升级到 R4；workspace、knowledge、models、completedTask、businessFile、localStorage 全部保留；确定性模型请求共 1 次，无重放、无页面错误。
- 故障选择器验证：读取用户数据前损坏隔离候选并选择 R1；读取数据后的未确认启动拒绝降级。使用真实包与选择器，未覆盖原生恢复窗口交互。候选阶段由验收器显式暂存，不能代替公开发现/UI 应用的在线验收。

## 冻结制品与后续资料

资源会复制 design/docs/legal，因此本报告和开发记录的后续回填不会出现在已冻结 ZIP 内，不能宣称全部资源字节等同仓库最新版本。官网、README 和实际发布证据在投放后独立提交，不改写已签名候选。Builtins 实际入口为 src/backend/core/knowledge/builtins.ts，白名单正文在 design/runtime、business、capability、connector 及列明的 task 规范中；本轮后续回填仅 development-log 和此 verification，不改白名单正文、运行入口、产品依赖或版本说明。

## 完整 CI 与产品 PR 合并

- [43386158632](https://github.com/nan023062/cbim/actions/runs/43386158632) 在精确 head `ae6deee959cec22db2daff8abc75aa90439e7825` 四片均成功。共 435 测试文件、2966 用例通过、0 失败、2 跳过；每片文件数 109/109/109/108，通过数 727/864/732/643。类型、架构、品牌和官网构建均通过。
- 两项跳过沿用既有前置条件：`tests/owner-execution-legacy.test.ts` 需要真实 pre-owner 历史 EXE，`tests/knowledge-source-lifecycle-application.test.ts` 需要真实 pre-source 历史 EXE；runner 均未提供这些旧包。未新增 skip，未用现代包或替身冒充旧数据迁移。
- [PR #66](https://github.com/nan023062/cbim/pull/66) 于 `2026-11-13T07:45:48Z` 正常 merge，提交 `b00f6928c7e110ec204326d9cceaaf228d6ec74f`，未 squash 或绕过检查。冻结 source 为合并祖先，`git diff --name-only ae6deee9 b00f6928` 为空，完整树一致。
- 投放前重新确认公开 latest.json 仍为 R3 原摘要，未出现并发通道变更；独立冻结 worktree 的 HEAD 保持 source，发布器再次验签、追加哈希 ZIP 与最后切换清单。

## 公开通道与缓存恢复

- `pnpm publish:runtime build/runtime/c0.1.15-r4-B5kpQx` 完成候选与公开 R/E 字节校验、追加 ZIP 和清单切换后，因最后匿名回读仍得到缓存 R3 而退出 1。保留 `publish.log`，未重新运行发布器或重复上传。
- 按 Release ID `442909771` 回读，R4 ZIP asset `742781739`，3904698 字节，摘要与候选一致；latest.json asset `742797473`，3701742 字节，SHA256 `4ff9b4025fecadd352bdfd509a2300adab33e7726d0bd34c4bf96f2a8904e018`，更新于 `2026-11-13T07:57:21Z`。两附件均 uploaded。旧 Python latest 仍为 `327801733 / v1.0.2`。
- `2026-11-13T07:58:40.337Z`，带诊断查询参数的匿名下载已通过原 C 公钥验签并与候选完全一致；`2026-11-13T07:59:16.251Z`，不带诊断参数的正常客户端地址也返回 R4，source/digest/signature 均一致。公开更新通道核验通过；缓存传播约两分钟，无需写入恢复。
- 既有资源 Release 标题/正文已同步 R4，继续保留 prerelease 与 `make_latest:false`，旧 tag、冷安装包和引擎不变。官网时间使用新 latest.json 资产时间，不使用原资源通道创建时间。
- 在线隔离验收 [43389737725](https://github.com/nan023062/cbim/actions/runs/43389737725) 以同一 source/digest 和 `mode=online` 通过，报告完成于 `2026-11-13T08:02:24.333Z`。真实 C 0.1.15 / R1 客户端由原定时器匿名发现并准备 R4；普通退出后仍为 R1，显式点击“版本与更新”后真实重启到 R4。workspace、knowledge、models、completedTask、businessFile、localStorage 均保留，确定性模型总请求仍为 1，无重放、0 页面错误。报告、ready 状态与真实新进程回执均已下载保存。

## 官网验证与收尾边界

- 首页、下载页、README 和 `website/release.json` 同步 R4 实际范围；冷安装包仍是 C 0.1.15 / 内置 R1、111828931 字节，SHA256 `b9a8ecbf29e2a285f2dd963fad5379f306f7c4fba9e11bc35ff9eeefee019a69`，未签名状态不变。保留 Search Console、canonical、robots 与 sitemap。
- 在独立 `build/release-r4-website` 检出执行 `pnpm check:brand`、`CBIM_WEBSITE_URL=https://nan023062.github.io/cbim/ pnpm build:website`，均通过；`CBIM_WEBSITE_PORT=4184 node scripts/preview-website.mjs` 与 `CBIM_WEBSITE_TEST_URL=http://127.0.0.1:4184/ node scripts/website-smoke.mjs` 覆盖 320/390/1280 px、深浅色两页及独立离线两页，共 14 场景通过，0 页面错误、无横向溢出。下载链接及安装包摘要正确；已查看 320 px 深色下载页截图。
- 本阶段只更新官网和发布事实，不重跑本地产品单元/类型检查；收尾 PR 仍执行既有完整四片 CI。合并后的 Pages 六文件匿名摘要与最终双分支回执由该 PR/关联 #65 评论及 `test-results/release-r4/publication-journal.jsonl` 继续追加，不改写已公开资源包。
