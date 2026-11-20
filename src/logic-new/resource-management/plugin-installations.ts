/** 持有用户的插件安装意图，在重启后按签名目录复核并恢复。 */
import fs from 'node:fs/promises';
import path from 'node:path';

type ProductType = 'engine' | 'connector';
interface Manager
{
  Init(): Promise<unknown>;
  Read(): Promise<{revision:number; items: {kind:string; active?:{identity:string}; candidate?:{identity:string}}[]}>;
  Install(kind:string, expected:{revision:number;identity:string}): Promise<void>;
}

export class PluginInstallations
{
  private readonly activeInstalls = new Map<string, Promise<void>>();
  public constructor(private readonly root:string, private readonly managers: Partial<Record<ProductType, Manager | undefined>>, private readonly stopping:()=>boolean, private readonly changed:()=>void)
  {
  }

  public Install(type:ProductType, kind:string, identity:string, revision:number)
  {
    if (!/^[a-z][a-z0-9-]{0,47}$/.test(kind) || !/^[a-f0-9]{64}$/.test(identity)) throw Error('插件身份无效');
    const manager = this.managers[type];
    if (!manager) throw Error('插件宿主不可用');
    const name = type + '.' + kind + '.' + identity;
    const running = this.activeInstalls.get(name);
    if (running) return running;
    const marker = path.join(this.root, name);
    const job = (async () =>
    {
      await fs.mkdir(this.root, {recursive:true});
      await fs.writeFile(marker, '');
      try { await manager.Install(kind, {identity, revision}); }
      finally { if (!this.stopping()) await fs.rm(marker, {force:true}); this.changed(); }
    })().finally(() => this.activeInstalls.delete(name));
    this.activeInstalls.set(name, job);
    return job;
  }
  public async Restore()
  {
    const markers = await fs.readdir(this.root).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
    for (const name of markers)
    {
      if (this.stopping()) return;
      const match = /^(engine|connector)\.([a-z][a-z0-9-]{0,47})\.([a-f0-9]{64})$/.exec(name);
      if (!match) continue;
      const type = match[1] as 'engine' | 'connector';
      const manager = this.managers[type];
      if (!manager) continue;
      await manager.Init();
      const snapshot = await manager.Read();
      const item = snapshot.items.find(row => row.kind === match[2]);
      if (item?.candidate?.identity === match[3] && item.active?.identity !== match[3])
        await this.Install(type, match[2], match[3], snapshot.revision).catch(console.error);
      else await fs.rm(path.join(this.root,name), {force:true});
    }
  }

}
