import {it,expect,vi} from 'vitest';import fs from 'node:fs/promises';import path from 'node:path';
import {createControlledHost} from './controlled-file-electron-fixture';
import {scopedData,scopedProvider} from './scoped-execution-provider';
import {scopedRecords} from './scoped-execution-fixture';
import {FileRunStorage} from '../src/backend/main/persistence/tasks/run-storage';
it('真实Electron/Pi按冻结范围完成隔离执行、受控写、读取基线和目标审阅',async()=>{
 const provider=await scopedProvider(),host=await createControlledHost();let keep=false;try{
  const seed=await host.request('seed-scoped',{providerUrl:provider.url});provider.bind(seed.agentId,seed.moduleId,seed.selection);const start=await host.dispatch('loop.chat',{id:seed.entry.id,message:scopedData.goal,options:{permission:'execute',turnTimeoutMs:60000}});
  await vi.waitFor(async()=>{expect(provider.errors).toEqual([]);expect((await scopedRecords(host.user,seed.entry.id)).scopes[0]?.status).toBe('closed');expect((await host.dispatch('runtime.snapshot',{})).pressure.activeRuns).toBe(0)},{timeout:90000,interval:50});
  const records=await scopedRecords(host.user,seed.entry.id);expect(records.scopes[0].outcome).toBe('completed');expect(records.runs).toHaveLength(1);const run=records.runs[0];expect(run.prepared.modules[0].workflowContract).toEqual(seed.contract);
  const summary=await new FileRunStorage().read(path.join(host.user,seed.entry.id,'dispatch','runs','tasks',run.binding.taskId,run.binding.runId));expect(summary.status).toBe('completed');expect(summary.unresolvedTools).toEqual([]);expect(summary.toolReceipts?.find(r=>r.toolCallId==='node')).toMatchObject({outcome:'succeeded',effects:['command']});
  for(const id of ['outside-read','outside-write','forged-native'])expect(summary.events.some(e=>e.type==='tool.allowed'&&e.data.id===id)).toBe(false);
  expect(summary.toolReceipts?.find(r=>r.toolCallId==='read-result')).toMatchObject({outcome:'succeeded'});expect(provider.state.capture.baseline.sourceCalls[0].toolName).toBe('cbim_scoped_read');expect(await fs.readFile(path.join(host.project,scopedData.file),'utf8')).toBe(scopedData.after);expect(await fs.readFile(path.join(host.project,'private.txt'),'utf8')).toBe('PRIVATE_SENTINEL');expect((await host.trace()).filter(t=>t.kind==='replace-confirmed')).toHaveLength(1);expect(provider.main).toHaveLength(6);expect(provider.member).toHaveLength(14);
  await fs.writeFile('test-results/scoped-pi-evidence.json',JSON.stringify({rootSessionId:start.taskId,run:run.binding,status:summary.status,main:provider.main.length,member:provider.member.length,node:provider.state.node,receipts:summary.toolReceipts,trace:await host.trace()},null,2));
 }catch(error){keep=true;await fs.writeFile('test-results/scoped-pi-failure.json',JSON.stringify({error:String(error),root:host.root,errors:provider.errors,diagnostics:host.diagnostics()},null,2));throw error}finally{await host.close();await provider.close();if(!keep)await host.remove()}
},120000);
