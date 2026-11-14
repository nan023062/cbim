import {test,expect,vi} from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {EnginePackages} from '../../../../src/logic/engines/packages';
import type {EngineArtifact,EngineArtifactsPort} from '../../../../src/logic/updates/engine-artifacts';

const artifact=(kind:string,letter:string,version='1.0.0',dependencies:EngineArtifact['dependencies']=[]):EngineArtifact=>({kind,identity:letter.repeat(64),version,nativeVersion:'1.0.0',protocol:1,dependencies});
async function fixture(){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-engine-manager-')),file=path.join(root,'installed.json');
  const pi=artifact('pi','a'),codex=artifact('codex','b','1.0.0',[{kind:'pi',identity:pi.identity}]);
  const versions={current:[pi,codex],available:[pi,codex]};
  const prepare=vi.fn(async(kind:string,identity:string)=>{const item=versions.available.find(v=>v.kind===kind&&v.identity===identity)!;return {root:path.join(root,identity),identity,entry:'native',version:item.nativeVersion,adapter:{entry:'adapter.cjs',version:item.version,protocol:1 as const}}});
  const port:EngineArtifactsPort={list:async()=>structuredClone(versions),check:vi.fn(async()=>{}),prepare};
  return {root,file,pi,codex,versions,prepare,port,manager:new EnginePackages(file,port),async cleanup(){if(path.dirname(root)!==os.tmpdir()||!path.basename(root).startsWith('cbim-engine-manager-'))throw Error('cleanup boundary');await fs.rm(root,{recursive:true,force:true})}};
}
test('安装完整依赖后原子激活，Codex 固定 Pi 依赖而非当前 Pi，运行引用阻止移除',async()=>{
  const f=await fixture();try{
    await f.manager.install('codex');expect(f.prepare.mock.calls.map(call=>call[0])).toEqual(['pi','codex']);
    const pi2=artifact('pi','c','1.1.0');f.versions.current=[pi2,f.codex];f.versions.available.push(pi2);await f.manager.install('pi');
    const runtime=await f.manager.resolveEngine('codex');expect(runtime.dependencies?.pi.identity).toBe(f.pi.identity);
    const release=runtime.retain!();await expect(f.manager.setEnabled('codex',false,true)).rejects.toThrow(/运行引用/);release();release();
    await expect(f.manager.setEnabled('pi',false,true)).rejects.toThrow(/依赖/);
    await f.manager.setEnabled('codex',false,true);await f.manager.setEnabled('pi',false,true);
    await expect(f.manager.resolveEngine('pi')).rejects.toThrow(/停用/);expect((await f.manager.list()).find(item=>item.kind==='pi')?.installed).toHaveLength(2);
  }finally{await f.cleanup()}
});
test('首次准备失败跨重开保留原因，不因后续对话重试，显式安装可以恢复',async()=>{
  const f=await fixture();try{
    f.prepare.mockRejectedValueOnce(Error('下载断开'));
    await expect(f.manager.resolveEngine('pi')).rejects.toThrow('下载断开');
    await expect(f.manager.resolveEngine('pi')).rejects.toThrow('下载断开');
    const reopened=new EnginePackages(f.file,f.port);await expect(reopened.resolveEngine('pi')).rejects.toThrow('下载断开');expect(f.prepare).toHaveBeenCalledTimes(1);
    await reopened.install('pi');expect((await reopened.list())[0].error).toBeUndefined();expect((await reopened.resolveEngine('pi')).identity).toBe(f.pi.identity);
  }finally{await f.cleanup()}
});
test('发现不激活，更新失败保留活动版与已取得实例，成功后新实例才使用新版',async()=>{
  const f=await fixture();try{
    await f.manager.install('pi');const old=await f.manager.resolveEngine('pi');const release=old.retain!();
    const pi2=artifact('pi','c','1.1.0');f.versions.current=[pi2];f.versions.available.push(pi2);
    await f.manager.check();expect((await f.manager.list())[0].active?.identity).toBe(f.pi.identity);
    f.prepare.mockRejectedValueOnce(Error('空间不足'));await expect(f.manager.install('pi')).rejects.toThrow(/空间/);expect((await f.manager.resolveEngine('pi')).identity).toBe(f.pi.identity);
    await f.manager.install('pi');expect((await f.manager.resolveEngine('pi')).identity).toBe(pi2.identity);expect(old.identity).toBe(f.pi.identity);release();
  }finally{await f.cleanup()}
});
test('远端索引不能新增可用引擎，缺失或未声明依赖在下载前拒绝',async()=>{
  const f=await fixture();try{
    f.versions.current.push(artifact('user-plugin','d'));expect((await f.manager.list()).some(item=>(item.kind as string)==='user-plugin')).toBe(false);
    await expect(f.manager.install('user-plugin' as never)).rejects.toThrow();
    f.versions.current=[artifact('codex','e','1.1.0')];await expect(f.manager.install('codex')).rejects.toThrow(/声明/);expect(f.prepare).not.toHaveBeenCalled();
  }finally{await f.cleanup()}
});
test('已冻结尚未启动的实例在停用后拒绝取得引用，缓存校验失败仅显式更新才重试',async()=>{
  const f=await fixture();try{
    await f.manager.install('pi');const runtime=await f.manager.resolveEngine('pi');await f.manager.setEnabled('pi',false);expect(()=>runtime.retain!()).toThrow(/停用/);
    await f.manager.setEnabled('pi',true);f.prepare.mockRejectedValueOnce(Error('缓存损坏'));await expect(f.manager.resolveEngine('pi')).rejects.toThrow(/损坏/);const calls=f.prepare.mock.calls.length;
    await expect(f.manager.resolveEngine('pi')).rejects.toThrow(/损坏/);expect(f.prepare).toHaveBeenCalledTimes(calls);
    await f.manager.install('pi');expect((await f.manager.resolveEngine('pi')).identity).toBe(f.pi.identity);
  }finally{await f.cleanup()}
});
