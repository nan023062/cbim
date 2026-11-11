import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {Application} from '../src/backend/main/application';
import {Paths} from '../src/backend/main/platform/paths';
/** 完整应用集成夹具：显式初始化 Application 并负责关闭和临时目录清理；纯数据改从 data/knowledge 导入。 */
export async function fixture(){const temp=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-test-'));const user=path.join(temp,'user');const a=path.join(temp,'a','same'),b=path.join(temp,'b','same');await fs.mkdir(a,{recursive:true});await fs.mkdir(b,{recursive:true});const app=new Application(new Paths(user,path.resolve('.')),path.resolve('design'));await app.init();return {temp,user,a,b,app,cleanup:async()=>{await app.shutdown();const target=path.resolve(temp);if(path.dirname(target)!==path.resolve(os.tmpdir())||!path.basename(target).startsWith('cbim-test-'))throw Error('Refusing to remove paths outside this test directory');await fs.rm(target,{recursive:true,force:true})}}}

/** 预期存在的真实回执必须先得到；缺失时直接失败，不能用类型断言掩盖。 */
export function required<T>(value:T|null|undefined):T {if(value===undefined||value===null)throw Error("Expected a present result");return value}
