const path = require('node:path');

// Only public certificate selectors belong in build configuration. The private key stays in the Windows provider.
function signingConfig(env = process.env) {
  const thumbprint = (env.CBIM_SIGN_CERT_SHA1 || '').replace(/\s/g, '').toUpperCase();
  const publisherName = (env.CBIM_SIGN_PUBLISHER || '').trim();
  const signTool = env.CBIM_SIGNTOOL_PATH;
  const store = env.CBIM_SIGN_STORE || 'CurrentUser';
  const timestampUrl = env.CBIM_SIGN_TIMESTAMP_URL || 'http://timestamp.digicert.com';
  if (!/^[A-F0-9]{40}$/.test(thumbprint) || !publisherName || /[\r\n\0]/.test(publisherName) || !signTool) {
    throw Error('SIGNING_NOT_CONFIGURED：请配置 CBIM_SIGN_CERT_SHA1、CBIM_SIGN_PUBLISHER 和 CBIM_SIGNTOOL_PATH；正式构建不允许跳过签名');
  }
  if (!path.isAbsolute(signTool) || !['CurrentUser', 'LocalMachine'].includes(store)) throw Error('SIGNING_CONFIG_INVALID：签名工具须为绝对路径，证书库须为 CurrentUser 或 LocalMachine');
  const url = new URL(timestampUrl);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) throw Error('SIGNING_CONFIG_INVALID：时间戳地址必须为公开 HTTP(S) 服务');
  if (env.CSC_LINK || env.WIN_CSC_LINK || env.CSC_KEY_PASSWORD || env.WIN_CSC_KEY_PASSWORD) throw Error('SIGNING_CONFIG_CONFLICT：本流程只使用 Windows 证书库，请移除 PFX 环境变量');
  return {thumbprint, publisherName, signTool, store, timestampUrl};
}

function updaterConfigYaml(version, publisherName) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version) || !publisherName?.trim()) throw Error('SIGNING_UPDATE_CONFIG_INVALID');
  return `provider: generic\nurl: https://github.com/nan023062/cbim/releases/download/desktop-v${version}/\nupdaterCacheDirName: cbim-desktop-updater\npublisherName:\n  - ${JSON.stringify(publisherName)}\n`;
}

module.exports = {signingConfig, updaterConfigYaml};
