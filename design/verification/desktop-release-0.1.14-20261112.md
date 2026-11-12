# CBIM 0.1.14 对话修复版发布与增量验收

日期：2026-11-12。用户明确授权推送 develop 并发布测试增量更新；开放 Issues 为空。范围为两个独立修复提交 dc3d21b8、92189dd6，以及本次版本和验收准备；沿用已确认的 Windows x64 未签名个人开发发行。

## 修复、冻结与完整 CI

- 统一查询工具在组合 Schema 时修正本地引用根位置，消除实际 cbim_state_inspect 工具定义 HTTP 400。普通主聊天首次请求失败且尚无回复/工具交互时，显式重发可沿可靠文件恢复或转交历史输入新建原生上下文；不猜测文件/身份、不改写原日志、不隐藏真实失败。
- 原有身份、未决工具、不完整日志及已发生交互的恢复保护保留。相关 54 个用例、类型与架构检查已通过，注释/契约/类图已同步；新增发布输入测试 40 项通过。
- 冻结 source/tag：`216a15e225dd646420afcd3e3cc618ef10f0391b`；候选为 build/release-014/build/desktop-release/0.1.14/unsigned-20261112-165638-af892228。make:desktop --unsigned 与两次 verify:desktop --unsigned 通过，47 个 PE payload、资源和四附件保持一致。
- 本次真实打包 EXE 的六项隔离测试通过：文件边界、禁网、超时、取消、非零退出、输出限制；全部自有资源回收。未在开发者现有安装上测试 NSIS。
- [完整四片 CI 43187108306](https://github.com/nan023062/cbim/actions/runs/43187108306)：准确 head 与冻结源码相同，411 文件、2807 项，2805 通过、0 失败、2 跳过。跳过为 owner-execution-legacy 和 knowledge-source-lifecycle-application 两个固定历史 EXE 迁移场景，runner 缺少其历史包，非新增跳过。
- [PR #57](https://github.com/nan023062/cbim/pull/57) 正常合并为 `bf283752f9f79d9a2bdd193e40729f5ac833688b`；合并 tree 与冻结 source 全部相同。后续只回填官网和维护记录，不改产品、构建、依赖或版本日志。

## 公开制品与通道

[正式发布](https://github.com/nan023062/cbim/releases/tag/desktop-v0.1.14)，Release ID 442699257，公开时间 2026-11-12T09:11:13Z。四附件在草稿、候选安装和公开之间 ID/大小/摘要一致；标签指向冻结源码。匿名元数据与校验清单读回、下载地址 HEAD 通过；旧 Python latest 保持 327801733 / v1.0.2。

| 附件 | Asset ID | 字节 | SHA-256 |
| --- | --- | --- | --- |
| CBIM-Setup-0.1.14-x64.exe | 738778266 | 392557720 | `8f607d25f924285aad452b002904b3fed14b7d843a1c5b64da7962f51bc07ff8` |
| CBIM-Setup-0.1.14-x64.exe.blockmap | 738780760 | 408796 | `cce7af188df7ff51bb5914929110154ea3495be44c1dd5d8c2e83a010382e2cd` |
| latest.yml | 738780951 | 348 | `f6adfd4c91f602d08a89ad7a3f4507728cf0063df0bfb5b43c2de3c6cf97a670` |
| SHA256SUMS.txt | 738781063 | 270 | `181828e20d70dfd968a5e53f60e6e0aecff7fb98c76ffc5fdf463b642542029b` |

草稿创建后按 tag 读取曾返回 404；通过分页列表和唯一 Release ID 核实同一草稿后继续，未重复创建、覆盖附件或移动标签。记录保留在本次 journal。

## 安装与真实在线增量

[候选安装 43187754941](https://github.com/nan023062/cbim/actions/runs/43187754941)，workflow/source 均为冻结 SHA，真实上一版 0.1.13。全新安装和真实上一版覆盖升级通过，新旧 NSIS 缓存均由实际安装产生且摘要正确；没有人工填充缓存。

[在线升级 43189315943 attempt 1](https://github.com/nan023062/cbim/actions/runs/43189315943/attempts/1)，workflow 为上述合并 SHA，source 与四附件仍为同一冻结候选，mode=online、transfer_expectation=differential。无 GitHub 凭据的已安装 0.1.13 由原定时器发现并下载公开新版；没有替换 GitHub 响应、hosts、代理或 TLS。

**0.1.13 → 0.1.14 实测安装包有效数据 1.74 MiB，对比完整 374.37 MiB 减少 99.54%，9 个 Range，零全量回退。** 精确值 1820327 / 392557720 字节；统计仅含已完成安装包响应，不含 blockmap、元数据、重定向和协议开销，仅代表本轮版本和环境。重建完整包摘要与公开安装器一致。

后台 ready 后保持旧版运行，关闭弹窗继续工作，普通退出不安装；重开后安装包请求为 0，复用完整缓存。通过真实界面点击“重启安装”，新进程携带原用户目录重启到 0.1.14，isPackaged=true、NotSigned。

十项保留通过：工作区、模型、同一已完成 task/run、localStorage、用户标记、知识/修订、业务文件、主 Agent 配置/修订、自动化定义及无业务重放。确定性模型请求 1 次、页面错误 0；这不代表用户在线模型供应商的质量已验收。

## 官网、资料与限制

官网和 README 从真实公开回执及本轮传输证据更新；同步保留签名提示、Search Console、canonical、robots 和 sitemap。官网 14 场景、收尾 PR 完整检查、master Pages 部署和六文件匿名摘要复核以收尾 PR 回执记录，不为追加最终 merge SHA 制造递归提交。

Forge 的 design/docs/legal 保留构建时副本，后续维护记录不追补到已公开包。收尾时另核对 24 项 Builtins 白名单正文及运行入口不变；不声称整个资源目录与后续仓库逐字节一致。原始证据位于 test-results/release-014-20261112/。

当前仍是未签名发行。旧客户端、缺少有效旧包或不支持 Range 的网络仍可能全量下载；完整缓存和 NSIS 解压安装体积没有变小。关闭/离线客户端需打开并联网，准备完成后由用户选择重启安装；不代表所有用户已自动升级。
