# 官网与下载页

官网与桌面运行时分开维护，静态页面没有账号、后台 API 或数据采集脚本。`index.html` 为产品首页，`download.html` 为下载、安装说明和当前更新日志；本目录是模板，构建产物才可直接预览或发布。

```powershell
pnpm build:website
pnpm preview:website
```

输出在 `build/website/`，本机预览 `http://127.0.0.1:4178`。两页分别内联样式与 SVG 图标，各自可离线打开；没有字体、框架 CDN 或外部图片依赖。附带的 `cbim.png` 仅供在线社交分享元数据使用。

拿到真实公开站点地址后，设置 `CBIM_WEBSITE_URL` 为含部署前缀的 HTTPS 根地址再构建，生成 canonical、Open Graph、SoftwareApplication 结构化数据与 sitemap。没有配置时不伪造域名。静态托管须支持直接访问 `/download.html`，不依赖 SPA 回退；搜索引擎收录仍须独立提交并等待抓取，不属于部署成功的保证。

## 发布快照的维护

- `release.json` 只记录已经公开的 **desktop-v** 发布。不得把 package.json 的开发版本、旧 Python `latest` 或未发布候选标为可下载版本。
- 更换下载版本时，通过 GitHub Release 核对 tag、文件名、大小、发布时间、SHA-256 与实际签名状态，再同步首页摘要、下载页日志及 FAQ。当前 0.1.1 未签名，品牌改动尚未随安装包发布。
- 同版本重发也会改变文件摘要，必须重新核对并更新这个快照；不要只换安装包而保留旧校验信息。
- 构建拒绝快照格式错误及未经文案更新的签名状态变化，复用 `pnpm check:brand` 检查品牌生成资源。
- 本次核实 XD Sites 仅提供公司网络，因此使用仓库已有的公开 GitHub Pages：`https://nan023062.github.io/cbim/`。不把公司内部访问地址当作公开官网。不上传源代码、`node_modules`、开发报告或任何凭据，只发布 `build/website/`。

## GitHub Pages 发布

`.github/workflows/website.yml` 在 `master` 的网站／品牌／构建文件变动时执行，也可从 `master` 手动运行。它读取现有 Pages 地址，以 Node 22 构建，不安装桌面依赖；只上传静态产物，随后使用已有 `github-pages` 环境发布。部署仍仅允许 `master`，不修改仓库的环境保护规则。

当前桌面开发在 `feat/cbim-production-governance`，与网站发布分开。网站发布从 `master` 的独立工作树只同步 `.gitattributes`、`.github/workflows/website.yml`、`branding/`、`website/`、`scripts/build-brand-assets.mjs` 及声明／渲染宿主、`scripts/build-website.mjs`、`scripts/preview-website.mjs`；不把整个桌面开发分支合入 `master`。后续修改这组网站源文件时应同步到发布分支并核对 Actions 的实际成功回执及公开页面；客户端代码变更不会自动发布桌面版本。

发布工作树不必改动 package.json；可用 `node scripts/build-website.mjs` 构建、`node scripts/preview-website.mjs` 本地预览。品牌原生资源重新生成需要桌面开发工作区的 Electron／Playwright 依赖。每次发布保留上一轮 deployment ID 与源码 SHA，便于回滚。

应用更新依然走独立桌面更新程序。官网只提供真实下载入口与已发布的日志，不管理用户账户、不新建反馈服务器。
