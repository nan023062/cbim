# Windows 客户端连接云端资源商城

先向服务管理员取得商城的 **HTTPS 站点根地址**。下文的 `https://registry.example.com` 是示例，请替换为真实域名。普通用户浏览、下载和更新免费资源不需要登录，也不用设置 `REGISTRY_TOKEN`。该地址只影响资源商城和引擎分发，不改变 CBIM 客户端自身的更新地址。

## 先试连，再保存

完全退出 CBIM，在 PowerShell 设置地址并请求商品目录：

```powershell
$env:CBIM_REGISTRY_URL = 'https://registry.example.com'
$base = $env:CBIM_REGISTRY_URL.TrimEnd('/')
curl.exe -i --max-time 15 "$base/v1/resources"
```

预期是 HTTP 200，正文为 JSON 数组；`[]` 表示连通但尚无已发布商品。变量里只填域名（可带 HTTPS 端口），不要附加 `/v1`、查询参数、片段或账号密码。只有本机回环地址允许 HTTP。

- **临时使用**：从刚才的 PowerShell 启动 CBIM（源码版在仓库根目录运行 `pnpm start`；安装版在该终端运行实际的 CBIM 可执行文件）。打开「资源商城」并刷新。从开始菜单另行启动的程序不会继承这次临时设置。
- **长期使用**：在同一 PowerShell 执行下面的命令，保存到当前 Windows 用户，不需要管理员权限。完全退出客户端，重新打开后再进商城。若从 IDE 或终端启动，也要重新打开启动器，避免继承旧值。

```powershell
[Environment]::SetEnvironmentVariable('CBIM_REGISTRY_URL', $env:CBIM_REGISTRY_URL, 'User')
```

## 连不上：先分清是哪一步失败

1. **客户端仍提示连接本机**：在用于启动客户端的新 PowerShell 中比较下面两个值。第一行是这个进程真正会传给客户端的值；第二行是用户持久配置。不同则重新打开启动器，并确认客户端版本支持此设置。显式 URL 优先于旧端口；无效或不可用时不会回退到本机。

   ```powershell
   $env:CBIM_REGISTRY_URL
   [Environment]::GetEnvironmentVariable('CBIM_REGISTRY_URL', 'User')
   ```
2. **目录请求连 HTTP 状态码都没有**：在客户端电脑上运行以下命令（先确保当前终端已设好 URL）。DNS 查不到地址，核对域名与解析；TCP 不通，核对网络、云防火墙和 Caddy 的监听端口；TCP 通但提示证书错误，核对域名、证书链和本机时间，不要跳过证书验证。

   ```powershell
   $uri = [uri]$env:CBIM_REGISTRY_URL
   Resolve-DnsName $uri.DnsSafeHost
   Test-NetConnection $uri.DnsSafeHost -Port $uri.Port
   ```
3. **返回了 HTTP 状态码**：目录接口返回 301/302 时，改用重定向后的最终 HTTPS 站点根地址，客户端不会跟随跳转。404 或返回 HTML，检查域名是否指向商城站点，以及 Caddy 是否原样转发 `/v1/resources`。502/503 时请管理员在服务器上检查 `systemctl status cbim-registry`，并用 `curl -i http://127.0.0.1:4179/v1/resources` 区分服务未启动和反代配置错误。无需把 4179 开放到公网。
4. **能逛商城，但引擎不能安装或更新**：目录和签名索引是两个接口。在同一终端执行 `curl.exe -i --max-time 15 "$base/v1/engine-index"`（`$base` 取自试连步骤）。404 请管理员检查签名索引是否已部署；200 只说明文件可访问，签名、有效期和制品摘要仍须通过客户端校验。只有某个版本失败时，记录资源 ID、版本、报错和时间交给管理员，不要发送发布令牌。付费版本下载返回 403 属于权益限制；免费目录如果要求登录，应排查反向代理的访问控制。

## 恢复本机

```powershell
[Environment]::SetEnvironmentVariable('CBIM_REGISTRY_URL', $null, 'User')
Remove-Item Env:CBIM_REGISTRY_URL -ErrorAction SilentlyContinue
```

完全退出并重新启动客户端。未设置 URL 时沿用 `CBIM_REGISTRY_PORT`；两者均未设置则使用 `http://127.0.0.1:4179`，需要有本机资源服务监听。若地址仍来自组织统一设置的系统环境变量，请联系管理员。

服务器的安装和日志排查入口见[云端部署说明](../services/resource-registry/deploy/README.md)。
