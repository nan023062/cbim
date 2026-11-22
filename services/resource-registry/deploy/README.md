# 部署单机资源服务器

Windows 客户端用户请看[连接云端商城与排查故障](../../../docs/resource-registry-client.md)。

适用于安装了 systemd、Caddy 和 Node.js 22.19+ 的 Linux 主机。以下操作以 root 执行。把本服务目录（至少含 src-server/）放在 /opt/cbim-resource-registry，确保服务用户可读。确认 /usr/bin/node --version；其他安装位置请调整 unit 的 ExecStart。

1. 创建仅 root 可读的 /etc/cbim-registry.env，内容为 REGISTRY_TOKEN=<随机发布令牌>。首次生成可运行下列命令；已存在时不要覆盖。只给授权的发布端设置相同的 REGISTRY_TOKEN，普通客户端无需令牌。

   ```sh
   (umask 077; set -C; printf 'REGISTRY_TOKEN=%s\n' "$(openssl rand -hex 32)" > /etc/cbim-registry.env)
   ```
2. 安装服务。systemd 管理 /var/lib/cbim-registry；程序更新不会覆盖这里的资源。迁移既有数据时先停止服务，将源端停服备份中的 registry.sqlite、blobs/ 和 signed-engine-index.json 一并恢复，确保服务账号可读写。

   ```sh
   install -m 0644 deploy/cbim-registry.service /etc/systemd/system/
   systemctl daemon-reload
   systemctl enable --now cbim-registry
   curl -fsS http://127.0.0.1:4179/v1/resources
   ```
3. 将真实域名指向服务器，开放 TCP 80/443，不要开放 4179。将 deploy/Caddyfile 中的站点块加入 /etc/caddy/Caddyfile，替换示例域名，保留已有站点。运行 caddy validate --config /etc/caddy/Caddyfile 后启动或重载 caddy 服务。用 curl -fsS https://你的域名/v1/resources 验证；有签名引擎时再检查 /v1/engine-index。
4. 客户端启动前设置 CBIM_REGISTRY_URL=https://你的域名，完全退出并重启客户端。不附加 /v1、查询参数或凭据。地址优先于旧 CBIM_REGISTRY_PORT；二者均未设置时仍使用 http://127.0.0.1:4179。远端仅接受 HTTPS；显式地址无效或连接失败时不会改连本机。此配置控制商城目录、发布、下载、签名引擎索引和安装包，不改变应用自身的更新通道。
