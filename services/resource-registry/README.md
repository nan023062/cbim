# CBIM 资源服务器

Windows 客户端用户请看[连接云端商城与排查故障](../../docs/resource-registry-client.md)。

云端部署与客户端地址配置见 [systemd 和 Caddy 部署说明](deploy/README.md)。

人力和业务还支持 `{"nodes":[...]}` 子树包。每个节点有稳定的 `key` 和指向父节点键的 `parent`，唯一根的 `parent` 为 null。人力节点携带 `kind/name/position`，岗位还可含 `skills:[{id,name,content}]`；业务节点携带 `name/summary/sources/virtual`。每次导入分配独立实例及节点身份。更新时按实例和稳定节点键比较，在项目修订号仍匹配时一次提交选定修改。发布商品图片支持 72 KB 以内的 PNG、JPEG、WebP，元数据 `logo` 随版本发布并固定。

发布接口支持可选 JSON 元数据 `name`、`summary`、`developer`、`preview`、`changes` 与整数人民币分 `priceCnyFen`。版本发布后元数据固定。旧版本缺价时商城显示「价格未提供」。正价版本可浏览，服务端在锁定和下载阶段返回 403，等待权益服务接入。

商城的人力模板文件使用单个组织节点，例如 `{"kind":"agent","name":"评审员","position":"复核交付物"}`。业务模板使用根节点定义，例如 `{"parentId":null,"name":"交付复核","summary":"复核项目产物","sources":[],"virtual":false}`。两类文件上限 1 MiB；宿主核验所选版本的 SHA-256 后，由项目接口创建独立节点。

独立包位于 `services/resource-registry/`；`src-server/` 是服务端源码目录。运行需要 Node.js ≥22.19（内置 SQLite），无需安装第三方依赖。在本目录执行：

```powershell
$env:REGISTRY_TOKEN = [Guid]::NewGuid().ToString('N')
npm start
```

默认仅监听 127.0.0.1:4179；PORT 可覆盖端口。REGISTRY_DATA 可指定持久目录，默认 ./data。备份时先停止服务，再复制整个数据目录（registry.sqlite 与 blobs/ 缺一不可）。npm test 运行独立双客户端 HTTP 测试，使用临时目录和随机端口。

路径前缀 P = /v1/resources/{kind}/{id}/{version}。kind 为 engine、connector、talent 或 business；id 为小写字母开头的字母、数字、连字符；首版只接受三段数字版本。资源以原始字节传输，上限 512 MiB。

| 操作 | 请求 | 行为 |
| --- | --- | --- |
| 上传草稿 | PUT P/draft | 请求体为包；重新计算摘要。首次 201，相同内容重试 200，同版本不同内容 409。 |
| 发布 | POST P/publish | 校验目标摘要后公开版本，重复发布相同版本可重试。 |
| 发现 | GET /v1/resources | 仅列已发布版本。 |
| 锁定 | GET P/lock | 返回 kind、id、version、sha256、size 和相对下载 URL；客户端负责保存锁定记录。 |
| 下载 | GET P/download?sha256=摘要 | 只按精确版本和摘要返回字节，不自动升级。 |

两个写接口都要求 Authorization: Bearer <REGISTRY_TOKEN> 和 X-Content-SHA256（小写十六进制）。读取无需发布凭据，仅用于本机实验。SHA-256 用来验证内容是否与锁定记录一致，不代表可执行包已获得信任。该服务不解包、不运行制品；引擎和连接器的签名校验仍属于安装端。本包不启动桌面客户端，也不修改项目 .cbim。

## 桌面客户端

在同一个 PowerShell 中设置 REGISTRY_TOKEN，然后从仓库根目录用第二个进程运行服务（例如 Start-Process npm.cmd -ArgumentList "--prefix services/resource-registry start"），并运行 npm start 启动桌面端。服务与桌面进程必须继承相同的发布凭据；仅浏览和拉取无需凭据。如果服务设置了自定义 PORT，请把桌面进程的 CBIM_REGISTRY_PORT 设为同一端口。

从侧栏打开「资源商城」，选择引擎、连接器、人力或业务分类，填写资源 ID 与版本，选择单个文件发布。点「拉取此版本」后，在用户 .cbim/registry-cache/ 中按类型、ID、版本和 SHA-256 保存包，页面显示实际位置；拉取不等于安装、执行或导入项目。

## 执行引擎：下载、更新和卸载

在仓库根运行 `pnpm exec tsx scripts/seed-engine-registry.mjs [已签名索引文件] [归档目录]`。默认读取本机开发缓存，缺失的归档从官方发布附件取得。先核验官方签名和每个 ZIP 的摘要，再将索引中所有版本写入本机服务器，最后切换签名索引。普通资源上传不会使引擎自动成为可安装版本。发布新版时使用新的官方签名索引重复导入。

启动资源服务，再在启动桌面程序的环境设置 `CBIM_REGISTRY_PORT=4179`。资源商城的引擎分类点击检查更新，选择下载并安装或更新引擎。卸载解除本机活动选择，运行中或被依赖时会拒绝；已验证缓存按保留策略复用，服务器版本仍可再次安装。未设置端口时默认使用本机 4179。商城不可用时不回退到其他下载源。
