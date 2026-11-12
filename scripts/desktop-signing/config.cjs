const path = require('node:path');
const {AppInfo} = require('electron-builder');

// NSIS 从 package.name 派生 installer.exe 的缓存目录；更新配置和制品校验复用同一生产者，避免与 EXE/展示名混用。
const updaterCacheDirName = new AppInfo({metadata: require('../../package.json'), config: {}}).updaterCacheDirName;

// Only public certificate selectors belong in build configuration. The private key stays in the Windows provider.
function signingConfig(env = process.env) {
  const thumbprint = (env.CBIM_SIGN_CERT_SHA1 || '').replace(/\s/g, '').toUpperCase();
  const publisherName = (env.CBIM_SIGN_PUBLISHER || '').trim();
  const signTool = env.CBIM_SIGNTOOL_PATH;
  const store = env.CBIM_SIGN_STORE || 'CurrentUser';
  const timestampUrl = env.CBIM_SIGN_TIMESTAMP_URL || 'http://timestamp.digicert.com';
  if (!/^[A-F0-9]{40}$/.test(thumbprint) || !publisherName || /[\r\n\0]/.test(publisherName) || !signTool) {
    throw Error('SIGNING_NOT_CONFIGURED：请配置 CBIM_SIGN_CERT_SHA1、CBIM_SIGN_PUBLISHER 和 CBIM_SIGNTOOL_PATH；未签名发行须在构建和发布命令显式指定 --unsigned');
  }
  if (!path.isAbsolute(signTool) || !['CurrentUser', 'LocalMachine'].includes(store)) throw Error('SIGNING_CONFIG_INVALID：签名工具须为绝对路径，证书库须为 CurrentUser 或 LocalMachine');
  const url = new URL(timestampUrl);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) throw Error('SIGNING_CONFIG_INVALID：时间戳地址必须为公开 HTTP(S) 服务');
  if (env.CSC_LINK || env.WIN_CSC_LINK || env.CSC_KEY_PASSWORD || env.WIN_CSC_KEY_PASSWORD) throw Error('SIGNING_CONFIG_CONFLICT：本流程只使用 Windows 证书库，请移除 PFX 环境变量');
  return {thumbprint, publisherName, signTool, store, timestampUrl};
}

// 构建入口显式选择模式再传给子进程；缺少证书或签名失败绝不自动降级。
function desktopSigningMode(env = process.env) {
  const mode = env.CBIM_DESKTOP_SIGNING_MODE || 'signed';
  if (!['signed', 'unsigned'].includes(mode)) throw Error('RELEASE_SIGNING_MODE_INVALID');
  if (mode === 'unsigned' && ['CSC_LINK', 'WIN_CSC_LINK', 'CSC_KEY_PASSWORD', 'WIN_CSC_KEY_PASSWORD', 'CSC_NAME', 'WIN_CSC_NAME', 'CBIM_SIGN_CERT_SHA1', 'CBIM_SIGN_PUBLISHER'].some(key => env[key])) throw Error('RELEASE_SIGNING_MODE_CONFLICT：未签名发行不能同时指定签名身份');
  return mode;
}

function updaterConfigYaml(version, publisherName, mode = 'signed') {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version) || !['signed', 'unsigned'].includes(mode) || (mode === 'signed' ? !publisherName?.trim() : publisherName !== undefined)) throw Error('SIGNING_UPDATE_CONFIG_INVALID');
  return `provider: generic\nurl: https://github.com/nan023062/cbim/releases/download/desktop-v${version}/\nupdaterCacheDirName: ${updaterCacheDirName}\n` + (mode === 'signed' ? `publisherName:\n  - ${JSON.stringify(publisherName)}\n` : '');
}

module.exports = {signingConfig, desktopSigningMode, updaterConfigYaml, updaterCacheDirName};
