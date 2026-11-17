import {expect,it} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {LocalRepository} from '..';

it('本地仓库按身份和版本原子更新，失败不改变快照',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-resource-store-'));
  try{
    const repo=new LocalRepository(root),initial=await repo.Initialize();
    const args={repositoryId:initial.repositoryId,revision:initial.revision,item:{kind:'skill',name:'技能',summary:'',content:'# 内容'}};
    const saved=await repo.Save(args);expect(saved.items).toHaveLength(1);expect(saved.revision).not.toBe(initial.revision);
    await expect(repo.Save(args)).rejects.toMatchObject({code:'CONFLICT'});expect(await repo.Read()).toEqual(saved);
    await expect(repo.Remove({repositoryId:'11111111-1111-4111-8111-111111111111',revision:saved.revision,id:saved.items[0].id})).rejects.toMatchObject({code:'IDENTITY'});
    expect((await repo.Remove({repositoryId:saved.repositoryId,revision:saved.revision,id:saved.items[0].id})).items).toEqual([]);
  }finally{await fs.unlink(path.join(root,'cbim-resources.json'));await fs.rmdir(root)}
});
