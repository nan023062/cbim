export const repository = 'https://github.com/nan023062/cbim';

export const versionPattern = /^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/;

/** 稳定三段版本比较；非法版本不参与升级，不接受预发布或前导零。 */
export function compareDesktopVersions(a: string, b: string)
{
  if (!versionPattern.test(a) || !versionPattern.test(b))
    throw Error('桌面版本格式无效');

  const left = a.split('.').map(Number),
    right = b.split('.').map(Number);

  for (let i = 0; i < 3; i++)
    if (left[i] !== right[i])
      return left[i] > right[i] ? 1 : -1;

  return 0;
}

export function desktopInstallerName(version: string)
{
  compareDesktopVersions(version, version);

  return `CBIM-Setup-${version}-x64.exe`
}

/** 地址完全由校验后的版本构造，渲染进程和远端正文不能提供任意更新源。 */
export function desktopReleaseBase(version: string)
{
  compareDesktopVersions(version, version);

  return `${repository}/releases/download/desktop-v${version}/`
}
