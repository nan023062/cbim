// logic/workspace/service: module-owned integration coverage; keep the original scenario and cleanup semantics.
import {it,expect} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fixture} from '../../../application/unittest/support/helpers';
import {request} from '../../../knowledge/rules/unittest/data/knowledge';
import {Application} from '../../../../bridge/server/application';
import {Paths} from '../paths';
import {exists} from '../../../../core/platform/node/files/index';
it('managed resource and engine caches cannot become a workspace, including through directory aliases',async()=>{const f=await fixture();try{const cache=path.join(f.temp,'runtime'),child=path.join(cache,'packages'),alias=path.join(f.temp,'runtime-alias');await fs.mkdir(child,{recursive:true});await fs.symlink(cache,alias,process.platform==='win32'?'junction':'dir');const paths=new Paths(f.user,path.resolve('.'),[cache]);for(const target of [cache,child,alias])await expect(paths.Identity(target)).rejects.toMatchObject({code:'INSTALL_ROOT'});expect((await paths.Identity(f.a)).path).toBe(await fs.realpath(f.a))}finally{await f.cleanup()}});
it('拒绝安装根、资源子目录和安装目录别名，允许同级业务工程',async()=>{const f=await fixture();try{const install=path.join(f.temp,'install'),resources=path.join(install,'resources'),alias=path.join(f.temp,'install-alias');await fs.mkdir(resources,{recursive:true});await fs.symlink(install,alias,process.platform==='win32'?'junction':'dir');const paths=new Paths(f.user,install);for(const target of [install,resources,alias,path.join(alias,'resources')])await expect(paths.Identity(target)).rejects.toMatchObject({code:'INSTALL_ROOT'});expect((await paths.Identity(f.a)).path).toBe(await fs.realpath(f.a))}finally{await f.cleanup()}});
it('外部变化可被监听发现；任务取消有明确状态',async()=>{const f=await fixture();try{const e=await f.app.catalog.Add(f.a),w=await f.app.Open(e.id);const task=w.StartTask('validate');w.CancelTask(task.id);while(task.state==='running')await new Promise(r=>setTimeout(r,5));expect(task.state).toBe('cancelled');await fs.writeFile(path.join(f.a,'.cbim/README.md'),'# edited');await new Promise(r=>setTimeout(r,1600));expect(w.changed).toBe(true)}finally{await f.cleanup()}});
