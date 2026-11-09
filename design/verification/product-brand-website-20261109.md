# 产品品牌与官网验证（2026-11-09）

## 实现

统一完整产品名 CBIM Assistant、简称 CBIM。原创 C 形主体／独立模块图标以同一 SVG 为源，生成 PNG 和七尺寸 ICO，接入侧栏、欢迎页、窗口、EXE、安装器／卸载器配置与 favicon。官网首页、下载页各自内联样式与图标；包含真实版本、下载、校验文件、使用步骤、更新日志和常见问题。

稳定边界：用户数据、应用 ID、可执行文件／卸载器名称、GitHub 登录、运行与更新语义不变。低变化频率的图形源与高变化频率的发布快照分开，网页不依赖桌面服务。应用窗口与前端组件注释、main／components／shell 三处架构文档和 main／shell 契约同步。

## 本机证据

- `pnpm typecheck` 通过。首次发现新 `.mjs` 缺声明，补齐 `.d.mts` 后通过。
- `pnpm check:architecture` 通过，53 个目录／567 个源码样式文件，1119 个文件／5851 条含类型依赖、0 环。初次 `?url` 资源导入不被依赖检查器解析，改用 Vite 原生 SVG 导入后通过；没有放宽依赖检查规则。
- 依赖／架构与桌面更新相关 **39/39**，签名发布相关 **29/29**。报告：`test-results/branding-website/related-tests.json`、`signing-tests.json`。未运行全仓回归。
- `pnpm package` 完成构建 **20261109-105132**；`brand-desktop-smoke.mjs` 使用隔离用户目录启动真实 `CBIM.exe`，名称、两处图标加载、浅深色、打包资源摘要均通过，页面错误 0。Windows `ExtractAssociatedIcon` 提取的 32 px 图标与 ICO 资源逐像素一致（100%）。Electron shell 文件关联接口先前返回通用 EXE 图标，已区分为核验方法问题；PE 七组图像字节也与源资源一致。没有修改真实用户应用或资料。
- `website-smoke.mjs` 通过 **14 个场景**：两页 × 320／390／1280 px × 浅／深色共 12 项，加上两页分别复制后的离线呈现。没有水平溢出或页面错误，导航与下载目标、SHA-256 展开显示、404 通过。修正截图时离屏跳转链接的展示，保留键盘可用性。
- 通过 GitHub API 复核 `desktop-v0.1.1` 为非草稿正式发布；EXE 为 136046213 字节，SHA-256 为 `baf9418ab2954ed44780ac479a1747d0eb198cd1ca6686f8b4384f0174728952`。官网的链接、版本与摘要一致，不使用旧 Python latest。
- 真实 Pages 地址为 `https://nan023062.github.io/cbim/`。已按此前存在的地址生成 canonical、SoftwareApplication 数据、Open Graph、robots 与两页 sitemap；未注册域名或声称已被搜索引擎收录。

## 网站发布记录

XD Sites 当次只提供 `exposureOptions: [internal]`，没有互联网发布面；因此未创建公司网络站点，改用项目原有 GitHub Pages。现有环境只允许 master；保留此规则，不放开任意分支。

上线前的 Pages deployment 为 `4780900669`，源码 `0b61c01d8d49b5c2169e8b8f3b0c34545073293a`（2026-05-22）。旧首页另存于本机 `test-results/branding-website/previous-site.html`，原部署与源码仍可用于回滚。

网站专用提交 **`90b8d688e606619a82b132fbb0cddfea9f62e90d`** 已从 `d853168` 基线快进推送到 `master`，仅增加 17 个品牌／网站／构建文件，没有合并客户端开发分支。[Actions 42554310278](https://github.com/nan023062/cbim/actions/runs/42554310278) 的 Node 22 构建和部署均为 success；Pages deployment **`7645969655`**，环境 `github-pages`，来源分支 `master`。环境分支规则仍仅允许 master。

- [官网](https://nan023062.github.io/cbim/)与[下载页](https://nan023062.github.io/cbim/download.html)已公开，无需登录。
- 匿名 HTTPS GET 的首页、下载页、robots、sitemap、PNG 全为 200，五个文件与已验收本地产物逐字节一致；记录 `public-pages.json`。
- 上线后以真实 HTTPS 地址再次运行同一浏览器验收，14 个场景全通过、页面错误 0，导航及线上 404 通过；`website-report.json` 的 base 为正式地址，截图也来自正式页面。
- 安装包 HEAD 为 200，136046213 字节；公开 `SHA256SUMS.txt` 为 200，包含页面展示的同一摘要；记录 `download-receipt.json`。
- 两页的 canonical 与 sitemap 使用既有真实地址，没有臆造自有域名，也未改变 GitHub Release 附件。

## 限制

当前公开安装包仍为旧图标、未签名的 0.1.1；本次没有签名证书，没有构建／发布新的正式安装器，没有替换线上安装包，没有升级用户软件。新的 NSIS 图标配置已接入，实际签名安装器验收仍在签名任务中完成。搜索收录、商店上架和自有域名不是本次已完成事实。
