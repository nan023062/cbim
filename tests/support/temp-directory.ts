import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/** 只拥有本次创建的目录；不加载 Application、工作区或模型。 */
export async function tempDirectory(){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-unit-'));
  return {root,cleanup:async()=>{
    const target=path.resolve(root);
    if(path.dirname(target)!==path.resolve(os.tmpdir())||!path.basename(target).startsWith('cbim-unit-'))throw Error('Refusing to remove another directory');
    await fs.rm(target,{recursive:true,force:true});
  }};
}
