/**
 * 作用定位：本机应用目录、工程身份和知识路径的实际解析。
 * 设计原因：将安装位置、用户目录和签名程序缓存的链接边界留在平台层；实现 Core 的 StoragePaths 契约。
 */
import fs from 'node:fs/promises';

import path from 'node:path';

import os from 'node:os';

import { hash } from '../../core/io/serialization';

export class Paths
{
  constructor(readonly userRoot = path.join(os.homedir(), '.cbim'), readonly installRoot = path.resolve('.'), readonly protectedRoots: readonly string[] = [])
  {
  }

  async Identity(input: string)
  {
    if (!input?.trim())
      throw new Error('请选择项目目录');

    const real = await fs.realpath(input);

    if (!(await fs.stat(real)).isDirectory())
      throw new Error('项目根必须是目录');

    const relativeToInstall = path.relative(await fs.realpath(this.installRoot), real);

    if (!relativeToInstall || (!path.isAbsolute(relativeToInstall) && relativeToInstall !== '..' && !relativeToInstall.startsWith('..' + path.sep)))
      throw new Error('工具安装目录及其子目录不能作为业务工程');

    for (const blocked of this.protectedRoots)
    {
      const boundary = await fs.realpath(blocked).catch(error => { if (error.code === 'ENOENT') return path.resolve(blocked); throw error }),
        relative = path.relative(boundary, real);

      if (!relative || !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep))
        throw new Error('更新资源和引擎缓存不能作为业务工程');
    }

    const canonical = process.platform === 'win32' ? real.replaceAll('\\', '/').toLowerCase() : real;

    return { id: hash(canonical), path: real };
  }

  Project(id: string)
  {
    if (!/^[a-f0-9]{64}$/.test(id))
      throw new Error('无效项目标识');

    return path.join(this.userRoot, id)
  }
}
