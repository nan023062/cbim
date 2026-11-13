import {required} from './support/assertions';
import {it,expect} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {fixture} from './helpers';
import {ResourceRepositories} from '../src/backend/main/resources/resource-repository';
import {LocalRepository} from '../src/backend/main/resources/resource-store';
import {resourceKinds} from '../src/bridge/contracts/resources';

it('三类资源共用一个本地仓库和远端服务，切换统一生效',async()=>{
  const host=await fixture(),client=await fixture();
  try{
    const location=await folder(host.temp,'shared-resources');
    await host.app.dispatch('resources.configure',{mode:'local',location});
    let local=await host.app.dispatch('resources.list');
    for(const kind of Object.keys(resourceKinds)){
      local=await host.app.dispatch('resources.save',{repositoryId:local.repositoryId,revision:local.revision,item:{kind,name:kind,summary:'',content:'# '+kind}});
    }
    const stored=JSON.parse(await fs.readFile(path.join(location,'cbim-resources.json'),'utf8'));
    expect(stored.items).toHaveLength(Object.keys(resourceKinds).length);
    await host.app.resources.startSharing({lan:false,port:0});
    const connection=host.app.resources.connection();
    await client.app.resources.setAccountSession({accountId:'test-account',server:{location:connection.url,token:connection.token}});
    const remote=await client.app.dispatch('resources.list');
    expect(remote.repositoryId).toBe(local.repositoryId);
    expect(remote.items).toEqual(local.items);
    const saved=await client.app.dispatch('resources.save',{repositoryId:remote.repositoryId,revision:remote.revision,item:{kind:'connector',name:'remote connector',summary:'',content:'# remote'}});
    expect((await host.app.dispatch('resources.list')).items).toEqual(saved.items);
    await client.app.resources.setAccountSession(null);await client.app.dispatch('resources.configure',{mode:'local',location:await folder(client.temp,'other-repository')});
    expect((await client.app.dispatch('resources.list')).items).toEqual([]);
    await client.app.resources.setAccountSession({accountId:'test-account',server:{location:connection.url,token:connection.token}});
    expect((await client.app.dispatch('resources.list')).items).toEqual(saved.items);
  }finally{await client.cleanup();await host.cleanup()}
});
const item={kind:'agent',name:'专项架构师',summary:'团队架构能力',content:'# 职责\n维护架构边界。'};
it('未登录限制本地目录；账号占位隔离旧编辑，退出恢复本地，重启不冒充登录',async()=>{
  const f=await fixture();try{
    const location=await folder(f.temp,'local-account-test');
    await f.app.resources.configure({mode:'local',location});
    const local=await f.app.resources.read();
    await expect(f.app.dispatch('resources.configure',{mode:'remote',location:'http://127.0.0.1:1',token:'not-a-real-session'})).rejects.toMatchObject({code:'SESSION_REQUIRED'});
    await expect(f.app.dispatch('resources.setAccountSession',{accountId:'forged'})).rejects.toMatchObject({code:'ACTION'});
    await f.app.resources.setAccountSession({accountId:'account-a'});
    expect(f.app.resources.status()).toMatchObject({source:'server',session:{state:'signedIn',accountId:'account-a'},config:null});
    await expect(f.app.resources.configure({mode:'local',location})).rejects.toMatchObject({code:'ACCOUNT_REPOSITORY'});
    await expect(f.app.resources.save({repositoryId:local.repositoryId,revision:local.revision,item})).rejects.toMatchObject({code:'REPOSITORY_CHANGED'});
    const restored=new ResourceRepositories(f.app.paths);await restored.init();
    expect(restored.status()).toMatchObject({source:'local',session:{state:'signedOut'}});
    expect((await restored.read()).repositoryId).toBe(local.repositoryId);await restored.close();
    await f.app.resources.setAccountSession(null);
    expect((await f.app.resources.read()).repositoryId).toBe(local.repositoryId);
  }finally{await f.cleanup()}
});
it('旧远端配置不会在未登录时恢复连接，原文件保持不变',async()=>{
  const f=await fixture();try{
    const file=path.join(f.user,'resource-repository-settings.json');
    const content=JSON.stringify({mode:'remote',location:'http://127.0.0.1:1',repositoryId:'11111111-1111-4111-8111-111111111111',token:'legacy-secret-token'});
    await fs.writeFile(file,content);const restored=new ResourceRepositories(f.app.paths);await restored.init();
    expect(restored.status()).toMatchObject({source:'local',session:{state:'signedOut'},config:null});
    expect(await fs.readFile(file,'utf8')).toBe(content);await restored.close();
  }finally{await f.cleanup()}
});
async function folder(temp:string,name:string){const p=path.join(temp,name);await fs.mkdir(p);return p}
it('手选本地仓库持久保存资源并恢复配置，不改写旧资源或工作区',async()=>{const f=await fixture();try{const legacy=path.join(f.user,'resource-library.json');await fs.writeFile(legacy,'original');const location=await folder(f.temp,'repository');const status=await f.app.dispatch('resources.configure',{mode:'local',location});expect(required(status.config).location).toBe(location);let snap=await f.app.dispatch('resources.list');snap=await f.app.dispatch('resources.save',{repositoryId:snap.repositoryId,revision:snap.revision,item});expect(snap.items[0].name).toBe(item.name);expect(await fs.readdir(f.a)).toEqual([]);expect(await fs.readFile(legacy,'utf8')).toBe('original');const restored=new ResourceRepositories(f.app.paths);await restored.init();expect((await restored.read()).items[0].id).toBe(snap.items[0].id);expect(restored.status().sharing).toBeUndefined();snap=await restored.remove({repositoryId:snap.repositoryId,revision:snap.revision,id:snap.items[0].id});expect(snap.items).toHaveLength(0);await restored.close()}finally{await f.cleanup()}});
it('切换仓库拒绝旧页写入；切回保留各自资源；过期版本不覆盖',async()=>{const f=await fixture();try{const a=await folder(f.temp,'repo-a'),b=await folder(f.temp,'repo-b');await f.app.resources.configure({mode:'local',location:a});const first=await f.app.resources.read(),request={repositoryId:first.repositoryId,revision:first.revision,item};const saved=await f.app.resources.save(request);await expect(f.app.resources.save(request)).rejects.toMatchObject({code:'CONFLICT'});await f.app.resources.configure({mode:'local',location:b});expect((await f.app.resources.read()).items).toHaveLength(0);await expect(f.app.resources.save({...request,revision:saved.revision})).rejects.toMatchObject({code:'REPOSITORY_CHANGED'});await f.app.resources.configure({mode:'local',location:a});expect((await f.app.resources.read()).items).toHaveLength(1)}finally{await f.cleanup()}});
it('真实 HTTP 仓库鉴权、账号仓库读写、冲突及连接失败禁止回退',async()=>{const host=await fixture(),client=await fixture();try{await host.app.resources.configure({mode:'local',location:await folder(host.temp,'host-repo')});await host.app.resources.startSharing({lan:false,port:0});const connection=host.app.resources.connection();expect((await fetch(connection.url+'/v1/resources')).status).toBe(401);expect((await fetch(connection.url+'/v1/resources',{headers:{Authorization:'Bearer '+connection.token,Origin:'http://example.com'}})).status).toBe(403);await expect(host.app.resources.configure({mode:'remote',location:connection.url,token:connection.token})).rejects.toMatchObject({code:'SESSION_REQUIRED'});
  await client.app.resources.setAccountSession({accountId:'test-account',server:{location:connection.url,token:connection.token}});expect(JSON.stringify(client.app.resources.status())).not.toContain(connection.token);const remote=await client.app.resources.read();const saved=await client.app.resources.save({repositoryId:remote.repositoryId,revision:remote.revision,item});expect((await host.app.resources.read()).items[0].id).toBe(saved.items[0].id);await expect(client.app.resources.save({repositoryId:remote.repositoryId,revision:remote.revision,item})).rejects.toMatchObject({code:'CONFLICT'});await expect(client.app.resources.setAccountSession({accountId:'other-account',server:{location:connection.url,token:'wrong'.repeat(8)}})).rejects.toMatchObject({code:'UNAUTHORIZED'});expect(client.app.resources.status().config).toBeNull();expect(client.app.resources.status().source).toBe('server');await expect(client.app.resources.read()).rejects.toMatchObject({code:'NOT_CONFIGURED'});await client.app.resources.setAccountSession({accountId:'test-account',server:{location:connection.url,token:connection.token}});await client.app.resources.remove({repositoryId:saved.repositoryId,revision:saved.revision,id:saved.items[0].id});expect((await host.app.resources.read()).items).toHaveLength(0);await host.app.resources.stopSharing();await expect(client.app.resources.read()).rejects.toMatchObject({code:'CONNECTION'})
}finally{await client.cleanup();await host.cleanup()}});
it('损坏文件原样保留，安装目录与正式知识目录不能作为仓库',async()=>{const f=await fixture();try{for(const location of [path.resolve('.'),f.user])await expect(f.app.resources.configure({mode:'local',location})).rejects.toMatchObject({code:'PATH'});const knowledge=await folder(f.a,'.cbim');await expect(f.app.resources.configure({mode:'local',location:knowledge})).rejects.toMatchObject({code:'PATH'});const repo=await folder(f.temp,'bad-repo');await fs.writeFile(path.join(repo,'cbim-resources.json'),'broken');await expect(f.app.resources.configure({mode:'local',location:repo})).rejects.toMatchObject({code:'RESOURCE_DATA'});expect(await fs.readFile(path.join(repo,'cbim-resources.json'),'utf8')).toBe('broken');expect(f.app.resources.status().config).toBeNull()}finally{await f.cleanup()}});
it('远端仓库身份替换被检测，不能自动接受新仓库',async()=>{const host=await fixture(),client=await fixture();try{const location=await folder(host.temp,'repo');await host.app.resources.configure({mode:'local',location});await host.app.resources.startSharing({lan:false,port:0});const c=host.app.resources.connection();await client.app.resources.setAccountSession({accountId:'test-account',server:{location:c.url,token:c.token}});const replacement=await folder(host.temp,'replacement');await new LocalRepository(replacement).initialize();await fs.copyFile(path.join(replacement,'cbim-resources.json'),path.join(location,'cbim-resources.json'));await expect(client.app.resources.read()).rejects.toMatchObject({code:'IDENTITY'})}finally{await client.cleanup();await host.cleanup()}});
it('共享端口占用不改变当前仓库，关闭应用停止 HTTP 服务',async()=>{const f=await fixture();const occupied=http.createServer();await new Promise<void>(resolve=>occupied.listen(0,'127.0.0.1',resolve));try{await f.app.resources.configure({mode:'local',location:await folder(f.temp,'repo')});const port=(occupied.address() as any).port;await expect(f.app.resources.startSharing({lan:false,port})).rejects.toMatchObject({code:'EADDRINUSE'});expect(f.app.resources.status().sharing).toBeUndefined();expect((await f.app.resources.read()).items).toEqual([]);await f.app.resources.startSharing({lan:false,port:0});const c=f.app.resources.connection();await f.app.shutdown();await expect(fetch(c.url+'/v1/resources')).rejects.toThrow()}finally{await new Promise<void>(r=>occupied.close(()=>r()));await f.cleanup()}});
