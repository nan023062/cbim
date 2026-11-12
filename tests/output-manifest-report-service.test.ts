import {it,expect} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {manifestReportFixture} from './output-manifest-report-fixture';
import type {RunSummary} from '../src/backend/core/execution/types';

it('列举无文件读取，明确复核完整目录发现新增、移动和缺失，原日志及状态不变',async()=>{
  const f=await manifestReportFixture();try{
    const source=path.join(f.directory,f.input.taskId,f.input.runId,'events.jsonl'),bytes=await fs.readFile(source),state=structuredClone(f.state),listing=await f.service.read(f.input);expect(listing.log).toBe('verified');expect(listing.manifests).toHaveLength(1);expect(listing.verification).toBeUndefined();expect(f.checks).not.toHaveBeenCalled();expect(f.acquire).not.toHaveBeenCalled();
    expect((await f.service.read(f.selected)).verification?.state).toBe('matches');
    await fs.writeFile(path.join(f.directory,'outputs','new.txt'),'new');const added=await f.service.read(f.selected);expect(added.verification?.state).toBe('changed');expect(added.verification?.observed?.entries.some(e=>e.relativePath==='outputs/new.txt')).toBe(true);
    await fs.rename(path.join(f.directory,'outputs','new.txt'),path.join(f.directory,'outputs','moved.txt'));const moved=await f.service.read(f.selected);expect(moved.verification?.observed?.entries.some(e=>e.relativePath==='outputs/moved.txt')).toBe(true);
    await fs.unlink(path.join(f.directory,'File.txt'));expect((await f.service.read(f.selected)).verification?.observed?.roots).toContainEqual({relativePath:'File.txt',state:'missing'});
    expect(await fs.readFile(source)).toEqual(bytes);expect(f.state).toEqual(state);expect(f.release).toHaveBeenCalledTimes(4);expect(JSON.stringify(added)).not.toContain(f.directory);expect(JSON.stringify(added)).not.toContain('complete output');
  }finally{await f.cleanup()}
});
const mutations:Array<[string,(summary:RunSummary)=>void]>=[['原生身份',s=>{s.events.find(e=>e.type==='session.bound')!.data.sessionId='foreign'}],['冻结约定',s=>{delete s.events[0].data.workflowContracts}],['尾行截断',s=>{s.logIntegrity={partialTail:true}}],['缺暂存',s=>{s.events=s.events.filter(e=>e.type!=='artifact.manifest_captured').map((e,i)=>({...e,seq:i+1}))}],['跨任务',s=>{s.task.taskId='foreign'}]];
it.each(mutations)('无法核实原日志不读当前文件：%s',async(_name,mutate)=>{const f=await manifestReportFixture();try{const summary=structuredClone(f.summary);mutate(summary);f.inspect.mockResolvedValue(summary);const report=await f.service.read(f.selected);expect(report.manifests).toEqual([]);expect(report.verification?.state).toBe('unverifiable');expect(f.checks).not.toHaveBeenCalled()}finally{await f.cleanup()}});
it('读取中知识/图/日志变化使整份观察失效，旧知识变化另行说明',async()=>{
  const f=await manifestReportFixture();try{
    f.knowledge.mockResolvedValue({revision:'other'});const old=await f.service.read(f.selected);expect(old.issues.some(i=>i.code==='MANIFEST_KNOWLEDGE_CHANGED')).toBe(true);expect(old.verification?.state).toBe('matches');
    f.knowledge.mockResolvedValueOnce({revision:'one'}).mockResolvedValueOnce({revision:'two'});const changed=await f.service.read(f.selected);expect(changed.consistency).toBe('changed_during_read');expect(changed.verification?.state).toBe('unverifiable');expect(changed.verification?.observed).toBeUndefined();
    f.checks.mockImplementationOnce(async(snapshot,signal)=>{const check=await f.manifestFiles.check(snapshot,signal);f.state.graphs[0].cursor.seq++;return check});expect((await f.service.read(f.selected)).verification?.state).toBe('unverifiable');
    f.inspect.mockResolvedValueOnce(structuredClone(f.summary)).mockRejectedValueOnce(Error('late loss'));expect((await f.service.read(f.selected)).verification?.state).toBe('unverifiable');
  }finally{await f.cleanup()}
});
it('活动运行、缺清单、租约冲突或完整端口错误不降级为旧文件检查',async()=>{
  const f=await manifestReportFixture();try{
    f.state.runs![0].status='running';expect((await f.service.read(f.selected)).verification?.state).toBe('unverifiable');f.state.runs![0].status='completed';expect((await f.service.read({...f.selected,manifestId:'absent'})).verification?.state).toBe('unverifiable');expect(f.checks).not.toHaveBeenCalled();
    f.acquire.mockImplementationOnce(()=>{throw Error('busy')});expect((await f.service.read(f.selected)).verification?.state).toBe('unverifiable');
    f.checks.mockImplementationOnce(async(snapshot,signal)=>({...await f.manifestFiles.check(snapshot,signal),state:'changed'}));expect((await f.service.read(f.selected)).verification?.state).toBe('unverifiable');
    f.checks.mockImplementationOnce(async(snapshot,signal)=>{const value=await f.manifestFiles.check(snapshot,signal);value.observed!.scopes[0].workflowVersion='foreign';return value});expect((await f.service.read(f.selected)).verification?.state).toBe('unverifiable');
    expect(f.release).toHaveBeenCalledTimes(2);await expect(f.service.read({...f.input,rootSessionId:'foreign'})).rejects.toMatchObject({code:'TASK_NOT_FOUND'});
  }finally{await f.cleanup()}
});
