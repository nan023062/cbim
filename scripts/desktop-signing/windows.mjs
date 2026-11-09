import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const inspectScript = fileURLToPath(new URL('./authenticode.ps1', import.meta.url));
const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');

export function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {encoding: 'utf8', windowsHide: true, timeout: 120_000, maxBuffer: 8 * 1024 * 1024, ...options});
  if (result.error || result.status !== 0) throw Error(`SIGNING_COMMAND_FAILED：${path.basename(command)} (${result.error?.code || result.status})\n${result.stderr || result.stdout || ''}`);
  return result.stdout?.trim() || '';
}

/** Windows 证书库适配器；不导出私钥，不安装根证书，也不把未签名当作成功。 */
export function createWindowsSigner(config, {run = runCommand, platform = process.platform} = {}) {
  if (platform !== 'win32') throw Error('SIGNING_PLATFORM_UNSUPPORTED：签名和验签必须在 Windows 上执行');
  const inspect = (mode, target) => JSON.parse(run(powershell, ['-NoProfile', '-NonInteractive', '-File', inspectScript, '-Mode', mode, '-Target', target, '-Store', config.store]));
  function verify(file) {
    run(config.signTool, ['verify', '/pa', '/all', '/tw', file]);
    const result = inspect('signature', file);
    if (result.status !== 'Valid' || result.thumbprint !== config.thumbprint || result.publisherName !== config.publisherName || !result.timestampThumbprint) {
      throw Error(`SIGNATURE_INVALID：${path.basename(file)} 缺少有效的指定发布者签名或时间戳`);
    }
    return result;
  }
  return {
    preflight() {
      const cert = inspect('certificate', config.thumbprint);
      if (!cert.valid || !cert.hasPrivateKey || cert.selfSigned || cert.thumbprint !== config.thumbprint || cert.publisherName !== config.publisherName) {
        throw Error('SIGNING_CERTIFICATE_INVALID：证书不存在、过期、信任链无效、无私钥或发布者不匹配；不得使用自签名证书发布');
      }
      // A present certificate alone does not prove that the SDK executable is available.
      run(config.signTool, ['/?']);
      return cert;
    },
    verify,
    sign(file) {
      run(config.signTool, ['sign', '/sha1', config.thumbprint, '/s', 'My', ...(config.store === 'LocalMachine' ? ['/sm'] : []), '/fd', 'SHA256', '/tr', config.timestampUrl, '/td', 'SHA256', '/d', 'CBIM Assistant', file]);
      return verify(file);
    },
  };
}
