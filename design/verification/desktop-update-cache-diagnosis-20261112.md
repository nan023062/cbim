# 安装器缓存与差分下载衔接问题

日期：2026-11-12。A（0.1.10）和 B（0.1.11）已经公开，附件保持原样。本记录不将全量回退计为差分通过。

## 实际失败

[A → B 公开验收 43155757174](https://github.com/nan023062/cbim/actions/runs/43155757174)，workflow `a8e6f4ca42a8f52137305a16a8081fc7d54c433c`：A 自动发现 B，后台下载并进入 ready，缓存 SHA-256 与公开 B 一致，1 次模型请求、零页面错误。但被动网络记录为 1 次完整 HTTP 200 安装包响应，391409091 字节，0 个 Range。严格差分断言失败，尚未进入安装。

新旧 blockmap 均真实下载成功。构建配置写入 `updaterCacheDirName: cbim-desktop-updater`；锁定的 electron-builder `AppInfo.updaterCacheDirName` 则由 package.name `cbim-assistant` 得到 `cbim-assistant-updater`，NSIS 的 `APP_INSTALLER_STORE_FILE` 使用后者。下载器从前者寻找 installer.exe，缓存归属不一致。

此前本地传输冒烟主动准备旧包缓存，只证明下载器与差分重建，不证明 NSIS 自己产生正确缓存；候选安装测试也没有核对这一边界。这是本轮安装验收暴露的新缺口。

## 诊断与后续验收

验收器现在只读记录实际配置目录和 NSIS 默认目录的 installer.exe 存在、大小及摘要，不补造缓存。新候选全新安装必须证明配置目录的旧包摘要等于实际安装器。默认在线验收仍要求 Range > 0、没有全量响应且有效负载小于完整包。

单独的 `transfer_expectation=full-fallback` 场景只适用于预下载客户端的在线诊断，明确要求 0 Range、1 个完整响应、完整包大小和最终摘要匹配；其成功不代表差分通过。该场景用于继续验证原公开 A → B 的普通退出、完整缓存复用、明确点击后安装与数据保留，报告包含独立的 `differentialDownload` 结论。

受影响验证：`pnpm exec vitest run tests/desktop-acceptance-inputs.test.mjs tests/desktop-update-network-evidence.test.mjs`，2 文件 37 项通过；覆盖默认严格要求、显式诊断、非法模式拒绝及真实流量汇总。`pnpm check:dependencies`：1302 文件、6687 依赖、0 循环/违规。没有修改 src、发布附件、原断言或原失败报告；线上诊断结果另记。

原始证据：`test-results/release-ab-20261112/b-online-43155757174-attempt1/`。
