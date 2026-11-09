# Google Search Console 接入与收录核实（2026-11-09）

## 范围与身份

- 官网网址前缀：`https://nan023062.github.io/cbim/`。
- 使用 LINAN-XDT 的 Cindy「我的浏览器」中的现有 Google 登录，核对同一资源和账号后操作；完整账号标识仅保存在本地回执中。
- 用户授权验证该站点、提交 sitemap，并检查首页与下载页的收录。仅维护官网及开发记录，不改桌面运行时、安装包、签名配置或旧开发计划。

## 官网验证标记发布

- 从 Search Console 的 HTML 标记验证方式读取公开 `google-site-verification` 元标记，加入 `website/index.html` 的 `<head>`。该值是需公开且长期保留的所有权标记，不是登录凭据；不引入统计或追踪脚本。
- 本地开发树与独立 master 发布工作树分别执行 `node scripts/build-website.mjs`（`CBIM_WEBSITE_URL=https://nan023062.github.io/cbim/`），构建成功且首页、下载页、sitemap 字节一致。确认标记在首页 head 内；`git diff --check` 通过。
- 网站提交 `091b3195d097e9f516bc40074a1497bc85f1bb7d` 已推送 master；[Actions 42556389558](https://github.com/nan023062/cbim/actions/runs/42556389558) 的 build、deploy 均成功，结束时间 2026-11-09T03:26:33Z，deployment `7646268245`，目标 `github-pages`。
- 前一网站版本为 `90b8d688e606619a82b132fbb0cddfea9f62e90d`／deployment `7645969655`；回退到未含标记的旧页会影响所有权持续验证，须保留验证元标记。没有放宽 master 部署保护，也没有合并整个客户端开发分支。
- 匿名 HTTPS 核对三项均为 200 且与本地字节一致，回执在 `test-results/search-console/public-pages.json`：

| 页面 | SHA-256 |
| --- | --- |
| 首页 | `d4ca86814b40ca9c0b18236f3d24b38989e853c11f7428d83200014b59fe3321` |
| 下载页 | `743b2b007763d501525798ed18b977319a01bb8b623c60a987c68b9e816289bc` |
| sitemap.xml | `81f50d16399689577c6daa1be0b0dc56b7b4a2e301fd87333c2145a32362d260` |

## Search Console 实际状态

以下为 2026-11-09 的实际页面回执，时间采用 Asia/Shanghai。

### 所有权验证通过

用户完成 HTML 标记验证后，已进入该网址前缀资源的管理页面；随后[设置页](https://search.google.com/search-console/settings?resource_id=https%3A%2F%2Fnan023062.github.io%2Fcbim%2F)明确显示“您是经过验证的所有者”，资源添加日期为 2026-11-09。总览报告仍提示正在处理数据，约 1 天后查看，这不代表网页已经收录。

早先合成点击未可靠触发验证，桌面前台操作被 `USER_INPUT_ACTIVE` 拒绝；已由用户完成当次验证操作，不再作为待办，也没有重复申请资源。

### sitemap 已提交，读取尚未通过

- 提交一次后，Google 显示“已成功提交站点地图”。[详情页](https://search.google.com/search-console/sitemaps/info-drilldown?resource_id=https%3A%2F%2Fnan023062.github.io%2Fcbim%2F&sitemap=https%3A%2F%2Fnan023062.github.io%2Fcbim%2Fsitemap.xml)确认完整目标为 `https://nan023062.github.io/cbim/sitemap.xml`；列表中的 `/sitemap.xml` 是该资源内的显示路径，没有误提交到域名根目录。
- 列表状态仍为“无法抓取”、类型“未知”；详情为“无法读取此站点地图”，已发现网页数 0，未显示具体 HTTP 或解析错误。详情显示上次读取日期 2026/11/9，列表的该字段为空；两处实际展示分别保留，不据此推断已成功解析。
- 按 Google 官方排查方法，对同一完整 XML 地址运行实际网址测试。11:43:05 的[检查结果](https://search.google.com/search-console/inspect?resource_id=https%3A%2F%2Fnan023062.github.io%2Fcbim%2F&id=lqpEXGwFFcpXxvlmi3wQ2A&alt_id=vJ1GBBeZkiY1KYLn7HgqHA)显示“是否允许抓取：是”“网页抓取：成功”，用户代理为 Google 检查工具智能手机版。此结果证明当次检查工具可访问文件，不等同于 sitemap 处理服务已成功读取。
- 与线上字节一致的 XML 经系统 XML 解析器检查通过：正确的 sitemap 0.9 命名空间，仅含首页和下载页两个完整 HTTPS 地址。[人工处置措施报告](https://search.google.com/search-console/manual-actions?resource_id=https%3A%2F%2Fnan023062.github.io%2Fcbim%2F)显示“未检测到任何问题”。
- 当前没有确认读取失败的根因，不能把它定性为格式错误、站点被屏蔽或已经恢复。没有删除或反复重提 sitemap，也没有给 XML 文件申请搜索收录。Google 官方说明抓取失败后会继续重试几天；下一次复查以站点地图状态“成功”和发现 2 个网页为验收，再检查实际页面收录。若持续失败，依据新出现的具体错误继续排查。

### 首页与下载页：尚未收录，已申请

| 页面 | 已有索引结果 | 实际网址测试 | 请求结果 |
| --- | --- | --- | --- |
| [首页](https://nan023062.github.io/cbim/) | 尚未收录；Google 无法识别此网址，无历史抓取记录 | 11:36，“网址可编入 Google 索引”“网页可以编入索引” | 已请求编入索引，已加入优先抓取队列 |
| [下载页](https://nan023062.github.io/cbim/download.html) | 尚未收录；Google 无法识别此网址，无历史抓取记录 | 11:37，“网址可编入 Google 索引”“网页可以编入索引” | 已请求编入索引，已加入优先抓取队列 |

两页各提交一次，均取得成功回执；没有重放请求。实际测试与请求结果不能替代正式索引结果，也不能承诺搜索出现时间或排名。

公开页面摘要见 `test-results/search-console/public-pages.json`；资源身份、设置页、sitemap、两页索引／实际测试／请求回执及人工处置结果保存在本地 `test-results/search-console/console-receipts.json`。该目录按仓库现有规则忽略，不发布登录会话或浏览器凭据。检查链接需要已授权的 Google 账号，回执中的检查 ID 可能随 Google 过期；事实以本报告日期和留存文本为准。

## 维护边界

- 验证完成后仍须保留首页标记。维护方法见 [网站说明](../../website/README.md)。
- 项目位于 `/cbim/`；该子路径的 robots.txt 不会作为域名根目录规则被 Google 读取。根目录 robots 的 404 不禁止抓取，本步通过 Search Console 直接提交 sitemap。
- 所有权验证、站点地图读取、实际网址可抓取、索引申请与已经收录分别记录。没有 Search Console 的实际索引结果时不推断 Google 已经收录或排名。
- 本步未修改 `src/`，没有受影响的源码注释或目录类图；未运行无关桌面测试、全仓回归、重新打包或发布客户端。

参考：[所有权验证](https://support.google.com/webmasters/answer/9008080?hl=zh-Hans)、[站点地图报告](https://support.google.com/webmasters/answer/7451001?hl=zh-Hans)。
