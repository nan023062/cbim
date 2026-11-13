import {it,expect} from 'vitest';import fs from 'node:fs/promises';import path from 'node:path';
import {FileIsolationRecords,isolationOperationId} from '../src/logic/file-operations/platform/isolation/isolation-records';import {isolationFixture} from './isolation-recovery-fixture';
const test=process.platform==='win32'?it:it.skip;
test('新记录只读不建目录；可靠来源与单调阶段拒绝重复调用、乱序和损坏尾部',async()=>{
 const f=await isolationFixture();try{const directory=path.join(f.data,'missing'),store=new FileIsolationRecords(directory),run=f.record.origin.binding.runId,id=isolationOperationId(run,'node');expect(await store.list(run)).toEqual([]);await expect(fs.access(directory)).rejects.toBeDefined();
  await expect(store.append(run,id,{kind:'settled'},0)).rejects.toMatchObject({code:'ISOLATION_RECORD_INVALID'});const first=await store.append(run,id,{kind:'prepared',record:f.record},0);expect(first.revision).toBe(1);await expect(store.append(run,id,{kind:'prepared',record:f.record},0)).rejects.toMatchObject({code:'ISOLATION_RECORD_CONFLICT'});
  await store.append(run,id,{kind:'started',process:f.resource.host},1);await store.append(run,id,{kind:'settled'},2);await store.append(run,id,{kind:'cleaned'},3);expect((await new FileIsolationRecords(directory).read(run,id))?.phase).toBe('cleaned');await expect(store.append(run,id,{kind:'started',process:f.resource.host},4)).rejects.toMatchObject({code:'ISOLATION_RECORD_INVALID'});
  const file=path.join(directory,run,id+'.jsonl');await fs.appendFile(file,'incomplete');const bytes=await fs.readFile(file);await expect(store.list(run)).rejects.toMatchObject({code:'ISOLATION_RECORD_INVALID'});expect(await fs.readFile(file)).toEqual(bytes);
 }finally{await f.remove()}
});
test('哈希相同内容必须绑定原run/call；资源名字必须匹配原executionId',async()=>{
 const f=await isolationFixture();try{const store=new FileIsolationRecords(f.data),run=f.record.origin.binding.runId,id=isolationOperationId(run,'node');expect(()=>store.append(run,id,{kind:'prepared',record:{...f.record,resource:{...f.resource,jobName:'Local\\CBIM.Isolated.00000000-0000-4000-8000-000000000000'}}},0)).toThrow();await store.append(run,id,{kind:'prepared',record:f.record},0);await fs.mkdir(path.join(f.data,'other'));await fs.copyFile(path.join(f.data,run,id+'.jsonl'),path.join(f.data,'other',id+'.jsonl'));await expect(store.read('other',id)).rejects.toMatchObject({code:'ISOLATION_RECORD_ID'});
 }finally{await f.remove()}
});
