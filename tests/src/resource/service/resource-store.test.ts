import {expect,it} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {LocalRepository} from '../../../../src/resource/service/index';

it.each(['skill','workflow'])('%s 单项图标可保留、清除并重开仓库',async kind=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-item-logo-'));
  try {
    const repo=new LocalRepository(root);
    let state=await repo.Initialize();
    let id:string|undefined;
    for(const logo of [undefined,'data:image/png;base64,iVBORw0KGgo=','data:image/png;base64,AAAA',undefined]){
      state=await repo.Save({repositoryId:state.repositoryId,revision:state.revision,id,item:{kind,name:'示例',summary:'',content:'正文',logo}});
      id=state.items[0].id;
      expect((await new LocalRepository(root).Read()).items[0].logo).toBe(logo);
    }
  }finally{await fs.rm(root,{recursive:true,force:true})}
});

it('本地仓库按身份和版本原子更新，失败不改变快照',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-resource-store-'));
  try{
    const repo=new LocalRepository(root),initial=await repo.Initialize();
    const args={repositoryId:initial.repositoryId,revision:initial.revision,item:{kind:'skill',name:'技能',summary:'',content:'# 内容'}};
    const saved=await repo.Save(args);expect(saved.items).toHaveLength(1);expect(saved.revision).not.toBe(initial.revision);
    await expect(repo.Save(args)).rejects.toThrow('仓库已被修改');expect(await repo.Read()).toEqual(saved);
    await expect(repo.Remove({repositoryId:'11111111-1111-4111-8111-111111111111',revision:saved.revision,id:saved.items[0].id})).rejects.toThrow('仓库身份已变化');
    expect((await repo.Remove({repositoryId:saved.repositoryId,revision:saved.revision,id:saved.items[0].id})).items).toEqual([]);
  }finally{await fs.unlink(path.join(root,'cbim-resources.json'));await fs.rmdir(root)}
});
