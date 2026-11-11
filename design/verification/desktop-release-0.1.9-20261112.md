# CBIM 0.1.9 公开发布与在线升级验收

日期：2026-11-12（Asia/Shanghai）。**0.1.9 已公开，真实 0.1.8 在线升级、普通退出取消及十项数据保留/无重放检查通过。** 发行延续用户已选择的未签名个人开发模式，实际主程序和安装器均为 `NotSigned`，不将摘要校验表述为可信签名。

## 范围、源码与验证提交

- 用户授权“合并发布”；纳入 Issues #36–#45，PR [#48](https://github.com/nan023062/cbim/pull/48) 正常合并为 `ad1300680c1b9fc6e6cf14694122d5b4b642a91f`，保留 10 个独立 Issue 提交。本轮不吸收新工单。
- 冻结构建源码与标签：`ba5c6d99d13963145d1e800825b1957fa90c489a`，`desktop-v0.1.9`。发布 PR [#49](https://github.com/nan023062/cbim/pull/49) 的完整验证 head：`00ad5b4cd5d2e94fdcadde9bc554093719fca202`，base：`86e821649a88f8a15fe5376b1728c25fe4a755fb`；正常合并：`e47e3c0592782c3e792db4b1eed8a713f5434d34`。
- 构建与验证提交仅差 14 个 tests 文件；产品、依赖、构建配置、品牌、内置日志及所有 extraResource 输入未改变。核对实际 app.asar 无 tests 条目，合并树与验证 head 完全一致。标签指向冻结构建而非测试修复提交，且可追溯至 master。
- 本报告与后续官网记录不回写已冻结的安装包。Forge 复制整个 design/docs/legal，包内维护资料保留冻结文本，不宣称与仓库后续回填字节一致。

## 构建与候选安装

候选：`build/desktop-release/0.1.9/unsigned-20261112-053253-837bd9eb/`；buildStamp 为 `20261112-053253`（Asia/Shanghai）。打包目录：`build/unsigned-20261112-053253-837bd9eb/CBIM Assistant-win32-x64/`。`make:desktop --unsigned` 与 `verify:desktop ... --unsigned` 通过，47 项 PE payload、资源、更新元数据 SHA-512 和四附件摘要一致；app-update.yml 不伪装 publisherName。

- 真实打包 EXE SHA-256：`9c39a4e80ac6147c183e7156ca8c1995d98f1b533382f016391b37de2dd268f9`。六项隔离场景通过：文件边界、禁网、超时、取消、非零退出与输出上限，自有进程及临时资源回收。
- `scripts/architecture-ui-smoke.mts` 在该打包 EXE 上通过团队/业务文件树行菜单、预览取消、静态资源发布/应用和运行图隔离；可控模型 6 次请求、零页面/传输错误。不是在线模型质量评估。
- 候选 [run 43104540962](https://github.com/nan023062/cbim/actions/runs/43104540962)，workflow SHA 为冻结源码、mode=candidate：无原用户安装的 Windows runner 全新安装、真实 0.1.8→0.1.9 升级、十项保留/无重放通过；1 次模型请求、零页面错误。开发者已安装客户端未被操作。

## 回归失败、修正与最终完整 CI

首轮 [run 43104046707](https://github.com/nan023062/cbim/actions/runs/43104046707) 的 37 项失败保留为历史证据：错误回执已采用 code/message，但旧消费者仍从错误正文匹配错误码；旧反馈测试仍要求隐藏最终回复；IPC 数量仍写死为 172；长会话的原生摘要被测试模型误作成员回合；测试 HTTP 服务逐块转字符串破坏跨块中文，造成摘要长度断言失败。

修复分为 #40 回执消费者 `ee25d53e`、#41 最终回复 `8b8715e7`、其余发布夹具 `00ad5b4c`。保留原始权限、一次提交、同一原回执、状态及无重放断言；IPC 改为全量处理器/契约双向覆盖，并包含四项新增操作。真实 HTTP 分块用例先复现“界”变为替换字符，再用流式 UTF-8 解码修复，未降低正文一致性断言。产品源码不变。

受影响补测：回执相关 36 项、后续真实 Pi 场景 10 项、分块与治理反馈 4 项通过（存在重叠，不相加冒充唯一总数）；类型与依赖检查通过。最终 [run 43107187797](https://github.com/nan023062/cbim/actions/runs/43107187797) 在 PR 准确 head/base 完成四个 Windows validation job，均通过类型、架构、品牌、官网构建和全仓测试切片。

四份 JSON 去重汇总：**406 文件、2756 项，2754 通过、0 失败、2 跳过**。跳过的是依赖固定历史 EXE 的原有场景，没有用新包冒充旧格式：

- `owner-execution-legacy.test.ts`：reads genuine pre-owner queued/running/checkpoint records, settles old intent without rebinding, and rejects new legacy claims
- `knowledge-source-lifecycle-application.test.ts`：actual fixed pre-source EXE records reopen without automatic refs or writes, then only explicit capability adoption starts observed-existing tracking

依赖扫描 1295 文件、6680 条含类型依赖，0 循环、0 边界违规；58 目录、668 代码/样式文件的架构资料一致。

## 公开回执

账号 nan023062，仓库 nan023062/cbim，默认 develop。Release ID **442213737**，公开时间 `2026-11-11T22:12:32Z`，draft=false、prerelease=false、make_latest=false；[发布页](https://github.com/nan023062/cbim/releases/tag/desktop-v0.1.9)。旧 Python latest 保持 `327801733 / v1.0.2`。

| 附件 | Asset ID | 字节数 | SHA-256 |
| --- | --- | --- | --- |
| CBIM-Setup-0.1.9-x64.exe | 736986112 | 391461296 | `6862f4c8d05862599bcf1dbef9980822cdab8f4bae630cbd4ae99fc674bc8749` |
| CBIM-Setup-0.1.9-x64.exe.blockmap | 736987619 | 407863 | `15f4c7660d338c30de5cd5a74ec91b694e04fd0c90cdc922b6facc192cfb2dc7` |
| latest.yml | 736987723 | 345 | `f5fd7e9f275afef781934001a2ef943940368c54d0098b1c513d739c2b8d72d1` |
| SHA256SUMS.txt | 736987845 | 268 | `b400f99b7ee5e84e86680335d2ebb002bdfa79ff313244d20f4ee103a6e4f546` |

唯一草稿上传后核对资产 ID/状态/大小/digest，公开前再次核验同一候选与标签；匿名读取 latest.yml 和 SHA256SUMS.txt 与候选字节一致。公开线上测试另对完整安装缓存核对 SHA-256。没有替换已公开旧版附件或移动旧标签。

## 真实公开升级

[run 43109817691](https://github.com/nan023062/cbim/actions/runs/43109817691)，mode=online、previous_version=0.1.8，workflow SHA `e47e3c0592782c3e792db4b1eed8a713f5434d34`，构建源码与安装器摘要同上。

- 隔离 runner 安装真实公开 0.1.8，客户端无 GitHub 凭据；自动发现 0.1.9，由真实 UI 点击下载并校验完整缓存。
- 自动安装前普通退出后仍为 0.1.8；再次打开由用户动作重新发起下载，再自动安装重启。
- 新进程携带原测试用户目录，版本 0.1.9、isPackaged=true、NotSigned；最终更新状态为 current。
- 原工作区、模型、同一已完成 task/run、localStorage、标记、知识及版本、业务文件、主 Agent 选型及修订、自动化定义保持；自动化运行仍为空。总模型请求 1 次，零业务重放、零页面错误。

## 官网与交付边界

官网收尾 PR [#50](https://github.com/nan023062/cbim/pull/50) 的首次完整 CI [run 43110968497](https://github.com/nan023062/cbim/actions/runs/43110968497) 有一项 `isolation-recovery-crash.test.ts` 失败，其余三片通过。原测试的 finally 用“保留未完成核实的原隔离目录”覆盖了触发清理的原始错误，因此不能凭该消息断定产品根因。已补充原始错误链、隔离记录与宿主退出信息的失败归档，并纳入 CI artifact；进程退出、Job 收束、原对象删除等断言未改变。该单元本机定向复测通过，不能据此声称原始偶发问题已修复；收尾最终 CI 与部署结果关联在该 PR。发布前完整 CI、候选和公开在线升级的证据仍对应原冻结制品。

官网 release.json 的版本、标签、时间、文件名、大小、摘要、signed=false 均取公开回执；首页、下载页和 README 同步本版实际功能与 0.1.8 升级范围。品牌检查、官网构建及 14 场景浏览器检查通过，覆盖 320/390/1280 px、深浅色和两份独立离线页面，零溢出/页面错误。保留 Search Console、canonical、robots 与 sitemap。

官网和本报告随收尾 PR 进入 master 的既有 Pages 部署；该 PR 的准确 head、正常 merge 与部署回执关联最终交付，再将 master 快进同步 develop，不删除无关工作分支。发布后关闭本批已完成 Issues 并回填链接；线上部署匿名六文件摘要记录在本次原始证据目录。

Brave 真实付费账号/额度未联调；测试模型是可控响应，不代表在线模型质量或所有用户已升级。当前客户端每分钟检查，需用户主动开始下载，关闭/离线用户要启动并联网后检查。

原始证据：`test-results/desktop-release-019-20261112/`，含初始失败 CI、修正补测、签名、制品、打包 UI/隔离、草稿和公开追加日志、候选及在线 runner 报告、匿名元数据与官网证据。
