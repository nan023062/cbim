# C 0.1.15 / R3 发布记录

> 历史快照：正文中的目录、完成状态与验证数字保留记录日期的事实，不是当前实现清单。四层迁移后的现状请看 [源码契约](../../src/CONTRACT.md) 和 [Logic 边界](../../src/logic/BOUNDARIES.md)。

用户于 2026-11-13 明确要求实现后自动提交 PR 并发布版本。本次范围为供应商多协议自动适配，功能提交 `b0c802ed3f011c8bd54d2c6e826634ba66d79365`；61 个相关用例、6 组真实 React 界面检查、类型和架构检查已通过，详细验证见开发记录。当前开放 Issues 为空，未创建工单。

## 基线与发布方式

- 仓库/账号为 `nan023062/cbim` / `nan023062`，默认分支 develop。开始时远端 develop/master 均为 `3bcb562d7c54fe074352d7ddc0c3f1932883a17f`，本地只有上述独立功能提交领先，无未提交改动和开放 PR。
- 当前 C 为 0.1.15，公开资源为 R2，通道 Release `442909771` / `runtime-c0.1.15`。旧 Python latest 为 `327801733 / v1.0.2`，不改变其身份。
- 本次只构建 R3，基线为已验收 `build/runtime/c0.1.15-r2-utN5mA`。保持固定冷壳、同一 Ed25519 公钥和三个 E；不替换公开冷安装包或历史 ZIP。Windows 冷包保持此前明确的未签名模式，R3 仍须使用原资源私钥签名。
- 本机原用户安装不参与验收；候选与在线升级使用隔离 GitHub Windows runner。现有脚本覆盖真实安装 C 0.1.15 / R1 → R3，不能将此写成已验证 R2 → R3。

## 阶段记录

### 源码、CI 与候选

- 冻结源码 `98b7caf9ab86081d4ff1c8428417081696d51376`；[PR #63](https://github.com/nan023062/cbim/pull/63) 的 base 为 `3bcb562d7c54fe074352d7ddc0c3f1932883a17f`，正常 merge 为 `e85a81f0c2a8c702983616239ba35adcc113dd10`，与冻结提交文件树一致。
- [完整 Windows CI 43264249298](https://github.com/nan023062/cbim/actions/runs/43264249298) 四片通过：427 个测试文件，2886 通过、0 失败、2 跳过；类型、架构/依赖、品牌及官网构建通过。
- 跳过项为 `owner-execution-legacy.test.ts` 的真实 pre-owner 历史记录迁移，以及 `knowledge-source-lifecycle-application.test.ts` 的真实 pre-source EXE 迁移。两项均因专用历史 EXE 不存在，沿用既有 `skipIf`；未新增跳过，不能以此次 R1→R3 验收替代这些历史迁移。
- 使用原 Ed25519 身份执行 `pnpm make:resources build/runtime/c0.1.15-r2-utN5mA 3 design/releases/runtime-c0.1.15-r3.md`，唯一候选为 `build/runtime/c0.1.15-r3-Om0pQp`；构建后及公开前均执行 `pnpm verify:runtime build/runtime/c0.1.15-r3-Om0pQp` 通过。原三个 E ZIP 的长度、摘要和内容集合均已核验。
- 签名 payload digest：`90914d1f21408eb57a5ec622b77c91a92c50ebc7b0d2ea152d51fa108c8ef02f`；清单文件 SHA-256：`bf71ca714a1e3eaff69e86e558cbac477cc03448b31150ec37a105d7d8acbbbe`，3702652 字节。
- R3 ZIP：`resources-c0.1.15-r3-win32-x64-866c2fbf060011fb9d2c03819ece924e99c801e4bf82da164e014b4132756f86.zip`，3946676 字节（3.76 MiB），SHA-256 同文件名摘要。固定冷指纹仍为 `1bbb10bf276fad5bb811872d62f0f472bda0249a592db2a43c202a7c2a9cdc47`。
- 唯一验收草稿 `443254982 / runtime-c0.1.15-r3-candidate`，target 为冻结源码；清单/ZIP/冷元数据 asset ID 分别为 `740305822 / 740305823 / 740305827`，均与本地摘要一致。草稿保留为验收来源，不投放更新通道。

### 隔离安装与公开通道

- [候选验收 43264825490](https://github.com/nan023062/cbim/actions/runs/43264825490) 通过，workflow SHA 等于冻结源码。干净 Windows runner 安装真实 C 0.1.15 / R1，安装器 SHA-256 为 `b9a8ecbf29e2a285f2dd963fad5379f306f7c4fba9e11bc35ff9eeefee019a69`；由测试暂存真实签名 R3，再授权固定冷壳激活，不能称为公开下载验收。
- 工作区、知识、模型配置、completed 任务、业务文件和 localStorage 保留；确定性模型请求 1 次，无重放、无页面错误。真实包的加载前损坏被隔离并选择 R1；数据已访问但启动未确认时拒绝降级。失败分支覆盖资源选择器，不代表原生恢复弹窗已自动化验收。
- `pnpm publish:runtime build/runtime/c0.1.15-r3-Om0pQp` 完成所有公开 R/E 字节校验并上传新清单；立即回读因 CDN 返回旧 R2 而退出 1，原日志保留。未重跑发布、未重复覆盖 ZIP。随后使用客户端同一下载/验签函数只读核实：普通 URL 返回 R2，带诊断参数返回签名正确的 R3；2026-11-12T17:23:21.635Z 普通匿名 URL 也返回准确 R3 和相同签名，恢复核验通过。
- 公开 Release 仍为 `442909771 / runtime-c0.1.15`，prerelease、非 latest；原标签未移动，R1/R2 ZIP 保留。R3 ZIP asset `740355128`，清单 asset `740372867`，清单更新时间 `2026-11-12T17:20:36Z`。冷安装包和三个 E 未替换，Python latest 仍为 `327801733 / v1.0.2`。
- 本机诊断元数据曾因 PowerShell 默认编码算出错误 payload 摘要，在任何验收派发前按 UTF-8 修正；候选字节未改变。临时只读诊断脚本的 top-level await 编译错误已修正，不涉及产品或发布附件。

### 线上升级与官网

- [真实线上验收 43268945351](https://github.com/nan023062/cbim/actions/runs/43268945351) 于 `2026-11-12T17:26:21.964Z` 通过，workflow SHA `e85a81f0c2a8c702983616239ba35adcc113dd10`、同一冻结候选与 payload digest。无凭据的真实 R1 由原定时器发现/准备公开 R3；普通退出后仍为 R1，再启动后实际点击侧栏“版本与更新”，核对新进程与原用户目录、最终 R3 和无 pending。工作区/知识/模型/completed 任务/文件/localStorage 均保留；模型请求 1 次、页面错误 0、无业务重放。
- 官网根据公开附件回执更新 R3；C 安装包下载 URL、大小、摘要、未签名说明保持不变。`CBIM_WEBSITE_URL=https://nan023062.github.io/cbim/ pnpm build:website` 通过；`node scripts/website-smoke.mjs` 对 320/390/1280 宽度、明暗模式及单文件离线页面共 14 场景通过、0 页面错误，320px 下载页截图已检查。
- 官网与发布记录在后续独立 PR 中同步，部署与匿名六文件回读结果由该 PR 的合并/部署回执补充；本节不提前宣称部署完成。

## 验证边界与维护入口

只验收 C 0.1.15 / R1→R3，未单独从 R2 起点重跑；模型请求使用 localhost 确定性服务，未用用户真实 API Key 验证线上供应商、完整工具调用、推理或流式能力。官方协议地址以本轮查阅的官方文档为依据，不保证任意地区、套餐和网关自动识别。

供应商策略与接口选择位于 `src/backend/core/models/provider-presets.ts`、`provider-connections.ts`；设置与连接测试组件都位于 `src/frontend/settings/ProviderConnections.tsx`，由 `ModelSettings.tsx` 装配，启动快照由 `src/backend/main/models/llm-profiles.ts` 解析。16 个产品代码/样式文件的相关注释、11 份受影响类图及相关契约已随功能提交同步。后续新增同协议供应商优先扩充预设数据，未知地址用显式连接；不修改执行引擎的协议实现。

原始证据在 `test-results/release-r3/`，云端证据见上述 Actions。后续回填的 design 文档在仓库与冻结 R3 内的副本不同；不改写已发布 ZIP 补填记录，不将文档副本差异描述为全部资源字节一致。
