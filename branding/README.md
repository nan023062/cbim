# CBIM Assistant 品牌资源

- 完整产品名称：**CBIM Assistant**；紧凑界面使用简称 **CBIM**，保持大写。
- 图标源：`cbim-mark.svg`。开放的 C 形主体与独立模块表示有边界的连接与协作；完整方形图标用于应用、安装器、网页与产品入口。
- 原生资源：`pnpm build:brand` 用离屏 Chromium 从同一 SVG 生成 512 px PNG 和包含 16／24／32／48／64／128／256 px 的 ICO；一起提交 `generated.json`。`pnpm check:brand` 与 Forge 打包前核对摘要，拒绝陈旧生成资源。
- 前端由 `BrandMark` 引用 SVG；官网构建直接内联 SVG。正文排版不另造低清截图作为标志；窄侧栏只显示 CBIM，完整名称由无障碍标签表达。
- `com.cbim.assistant.desktop`、`CBIM Desktop.exe`、`CBIM.exe`、卸载器探测及 `.cbim` 数据目录是兼容身份，不因显示品牌调整而改名。

当前公开安装包 0.1.1 早于这次品牌调整，仍未签名。新图标随后续通过签名与安装验收的客户端候选交付；不能仅凭官网更新声称旧包已有新图标。
