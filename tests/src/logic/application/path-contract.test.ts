// logic/application: module-owned integration coverage; keep the original scenario and cleanup semantics.
import {it,expect} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './support/helpers';
import {request} from '../knowledge/rules/data/knowledge';
import {Application} from '../../../../src/bridge/server/application';
import {Paths} from '../../../../src/logic/workspace/service/paths';
import {exists} from '../../../../src/core/io/text-files';
it('用户目录不可写时不初始化业务工程，安装根不接受为工程',async()=>{const f=await fixture();try{const blocked=path.join(f.temp,'not-a-directory');await fs.writeFile(blocked,'occupied');const app=new Application(new Paths(blocked,path.resolve('.')));await expect(app.Init()).rejects.toThrow();expect(await exists(path.join(f.a,'.cbim'))).toBe(false);await expect(f.app.catalog.Add(path.resolve('.'))).rejects.toThrow(/安装目录/)}finally{await f.cleanup()}});
