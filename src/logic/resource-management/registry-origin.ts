/** 商城和签名引擎分发共用同一服务源；只有本机开发允许明文 HTTP。 */
export function registryOrigin(address: string | null | undefined = process.env.CBIM_REGISTRY_URL, port = process.env.CBIM_REGISTRY_PORT ?? '4179'): string {
  if (address != null) {
    let url: URL;
    try { url = new URL(address); } catch { throw Error('CBIM_REGISTRY_URL 不是有效的资源服务器地址'); }
    const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
    if (!(url.protocol === 'https:' || (loopback && url.protocol === 'http:')) ||
        url.username || url.password || url.pathname !== '/' || /[?#]/.test(url.href))
      throw Error('CBIM_REGISTRY_URL 需为 HTTPS 站点根地址（本机可用 HTTP），不能包含凭据、路径、查询或片段');
    return url.origin;
  }
  if (!/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535)
    throw Error('本机资源服务器端口无效');
  return 'http://127.0.0.1:' + port;
}
