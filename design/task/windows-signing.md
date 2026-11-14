# Windows 签名构建与 0.1.1 重发

后续决定（2026-11-09）：用户选择 0.1.2 先按未签名个人开发版本发行，日后取得证书再用更高版本切换签名。下文的 0.1.1 同版本签名替换保留为历史方案，不是当前发布指令；现在不重发或覆盖 0.1.1。默认签名流程与校验继续保留，显式未签名命令及共同验收步骤见[桌面发布指南](desktop-release.md)。

2026-11-09：用户要求将应用代码与安装包签名接入构建发布，并重发签名版 0.1.1；随后确认尚无证书。本次交付签名流程、校验及发布工具。**公开的 0.1.1 仍为原未签名版，真实签名／安装／重发尚未完成。** 实测范围见[验证记录](../verification/windows-signing-20261109.md)，实时进度见[roadmap](../tool-architecture-roadmap.md)。

## 先取得可用的签名身份

1. 由产品发布主体申请 Windows 公开可信的代码签名证书，完成 CA 的身份核验，并确认其证书链适用于公众电脑。自签名证书、内部企业根证书或普通 HTTPS 证书不能代替公众发行的代码签名身份。当前代码拒绝自签名、无私钥、过期或 Windows 信任链验证失败的证书；本机链验证通过本身不能证明某个私有根已经受所有公众电脑信任。
2. 当前适配方式是 **Windows 证书库 + Microsoft SignTool**。请先与证书供应商确认支持通过 Windows 的 CSP/KSP 使用硬件令牌或云 HSM，且可按证书指纹调用 SignTool。安装供应商要求的驱动／客户端，将证书关联到构建账号的 `CurrentUser\My`，或授权构建账号访问 `LocalMachine\My` 的私钥。私钥留在供应商的安全设备／服务内。
3. 安装 Windows SDK 的签名工具，找到 x64 `signtool.exe` 的实际绝对路径。不要把不明来源的签名工具放入流水线。
4. 仅使用 HTTP 签名 API、Azure Artifact Signing `/dlib` 等方式的服务尚未接入本适配器；取得该类服务后需要增加明确适配和真实验收，不能声称设置任意 Azure 环境变量即可生效。未来增加签名方式只替换构建层适配，保留产物验签与发布门禁，不修改产品运行时。

证书方案、身份／地区要求及硬件密钥要求以[微软签名选项](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options)和证书供应商为准；当前不代为购买或提交主体材料。SignTool 属于 Windows SDK，参数参考[微软 SignTool 文档](https://learn.microsoft.com/en-us/windows/win32/seccrypto/signtool)。签名用于验证发布者和完整性，不能承诺新文件立刻不再出现 SmartScreen 提示，参见[信誉机制](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation)。

## 在 LINAN-XDT 的构建账号配置

查看公开证书信息，不导出私钥：

```powershell
Get-ChildItem Cert:\CurrentUser\My,Cert:\LocalMachine\My -CodeSigningCert |
  Select-Object Subject,Thumbprint,NotAfter,HasPrivateKey

$signCert = Get-Item -LiteralPath 'Cert:\CurrentUser\My\<40位证书指纹>'
$signCert.GetNameInfo('SimpleName', $false)
```

在同一个 PowerShell 会话中配置公开选择器；值须替换为真实信息：

```powershell
$env:CBIM_SIGN_CERT_SHA1 = '<40位证书指纹>'
$env:CBIM_SIGN_PUBLISHER = '<上方 GetNameInfo 返回的完整发布者名称>'
$env:CBIM_SIGN_STORE = 'CurrentUser'
$env:CBIM_SIGNTOOL_PATH = 'C:\Program Files (x86)\Windows Kits\10\bin\<已安装SDK版本>\x64\signtool.exe'
$env:CBIM_SIGN_TIMESTAMP_URL = 'http://timestamp.digicert.com'
```

`CBIM_SIGN_CERT_SHA1` 是 Windows 证书选择指纹，**文件摘要和时间戳摘要实际均使用 SHA-256**。时间戳使用 RFC3161，可按供应商文档更换地址。当前流程不消费 `CSC_LINK`／`WIN_CSC_LINK` 或相应 PFX 密码变量，检测到冲突会停止；不要把私钥、PIN、密码或访问令牌放进聊天、仓库或发布回执。无人值守构建时由供应商的安全客户端／CI 凭据系统处理私钥访问，先确认账号权限及 PIN 交互是否适合自动运行。

## 构建、验收、发布

1. 先更新版本日志并完成代码检查。签名版 0.1.1 的说明应保留原功能说明，将旧的“尚未配置代码签名”改成此次准确的签名信息及同版本重装限制。当前公开未签名版的历史说明不提前修改；待签名条件具备后，在新构建提交中维护。提交冻结干净工作树后再构建，构建提交必须先推送才能发布。
2. 执行 `pnpm make:desktop`。缺少配置／无效证书时在 Forge 运行前停止；Forge 打包后先逐个签名真实 PE 应用／DLL／Windows 原生模块，再生成并签名 NSIS 卸载器与安装器。签名顺序不能调整为“生成更新清单后补签 EXE”。
3. 从命令输出取得本次独立候选目录 `build/desktop-release/0.1.1/signed-<时间>-<随机标识>/`。旧的 `build/desktop-release/0.1.1/` 四个附件保持原样。重新构建总是生成新目录，不复用失败候选。`build/desktop-signing.lock` 防止并行修改共享 Forge 输出；进程意外终止时先核实没有构建进程，再处理该精确锁文件，不能直接重跑覆盖。
4. 执行 `pnpm verify:desktop '<候选目录>'`。它重新验签应用、安装器与保留的签名卸载器，核对签名者／时间戳、打包资源摘要、文件清单、SHA256SUMS 和最终 EXE 的 SHA-512 更新元数据。签名在构建阶段发生，发布阶段不再改文件。`app-update.yml` 含发布者身份，签名版以后升级时由现有 electron-updater 校验；原未签名客户端不会被远程补写此配置。
5. 使用独立测试安装目录和用户目录安装候选，核对已安装主程序、DLL／原生模块及卸载器的签名，启动账号菜单和更新日志，正常关闭。实际验证 0.1.0 → 候选的下载／显式安装及数据保留，记录 Windows 验签结果、候选哈希和测试目录。**当前没有证书，这一步尚未执行；单元测试的替身不算实际签名或安装通过。**
6. 完成上述真实验收后，运行 `pnpm publish:desktop '<候选目录>' --replace`，用于本次已授权的同版本 0.1.1 签名替换。后续新版本省略 `--replace`。工具固定目标 `nan023062/cbim`，核对当前账号 `nan023062`、远端构建提交、对应桌面标签和旧通道 latest，先重新验签再写 GitHub。

同版本替换先下载并核对原四个附件，保存原 Release 元数据与摘要到候选的 `previous-release/`；备份失败不改公开版本。GitHub 不提供四附件原子替换，本流程临时将该 Release 转成草稿，再依次上传 EXE、blockmap、SHA256SUMS、`latest.yml`，远端大小／SHA-256 全部一致后重新公开。**该短暂窗口内下载地址不可用**；禁止多个发布者同时操作该版本。原 `desktop-v0.1.1` 标签不移动，发布正文分别列出原标签与实际签名构建提交，旧 Python 通道 latest 保持原值。如果仓库启用不可变 Release，原版本不能替换，需保留原版本并另行确定新版本号。

每次外部写入前后记录 `publish-journal.jsonl`。上传或公开请求结果未知时保留现场，脚本不会自行重复；同一候选已有日志时拒绝再次启动。先按日志中的 Release ID 读取 GitHub 实态、核对附件与摘要，再决定补齐草稿或恢复备份。不要删除日志后盲目重跑，也不要为恢复移动旧标签。脚本不会自动安装旧版或回放用户业务。

**已安装 0.1.1 的用户不会收到同版本新版提醒，需下载签名包手动重装。** 0.1.0 用户仍可升级到 0.1.1。若要让已安装 0.1.1 的用户自动发现签名升级，必须发布更高版本；本次不自行改成 0.1.2。

## 维护入口

| 变化点 | 修改位置 | 稳定边界 |
| --- | --- | --- |
| 证书库选择与签名提供方 | `scripts/desktop-signing/config.cjs`、`windows.mjs`、`authenticode.ps1` | 提供 preflight／sign／verify，私钥不出提供方 |
| 应用与原生运行库覆盖 | `payload.mjs`、`scripts/make-desktop.mjs` | Forge 的 `--prepackaged` 产物必须先签名，再进 NSIS |
| 安装器与卸载器签名 | `electron-builder-sign.cjs`、根 builder 配置 | electron-builder 26.18.0 的签名 hook；禁止跳签，保留卸载器证据 |
| 发布完整性规则 | `artifacts.mjs` | 重新验签真实字节、核对清单，不信任“已签名”布尔标记 |
| GitHub 发布步骤 | `publication.mjs`、`scripts/publish-desktop.mjs` | 先验签／备份，草稿中替换，逐项核对后公开，未知不重放 |

所有签名能力均在 `scripts/desktop-signing/`；产品的 `src/logic/updates/service/` 和业务运行时代码本次未修改。Forge 只写公开发布者配置，NSIS 继续每用户安装，不附加无需使用的提权帮助程序。证书轮换但发布者名称不变时主要调整配置；若改变发布主体名称，需单独设计旧安装版的更新兼容，不能为了通过验收关闭发布者校验。
