import {afterEach,expect,test} from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {repairPiToolResult} from '../scripts/repair-pi-tool-result.mjs';

const roots:string[]=[];
const sha256=(data:Buffer)=>createHash('sha256').update(data).digest('hex');
const idle={assertIdle:async()=>{}};
afterEach(async()=>{for(const root of roots.splice(0)){const resolved=path.resolve(root);if(path.dirname(resolved)!==path.resolve(os.tmpdir())||!path.basename(resolved).startsWith('cbim-session-repair-'))throw Error('不清理本次测试目录以外的路径');await fs.rm(resolved,{recursive:true,force:true})}});
async function fixture(extra?:Record<string,unknown>){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-session-repair-'));roots.push(root);
  const sessions=path.join(root,'pi','sessions');await fs.mkdir(sessions,{recursive:true});
  const sessionFile=path.join(sessions,'session.jsonl');
  const lines=[
    '{"type":"session","id":"session","timestamp":"2026-11-06T10:00:00.000Z"}\r\n',
    ' { "id": "before", "type": "message", "message": {"role":"assistant","content":[{"type":"thinking","thinking":"synthetic private sample"},{"type":"text","text":"known answer"}]}}\r\n',
    JSON.stringify({id:'broken',parentId:'before',type:'message',timestamp:'2026-11-06T10:39:47.076Z',message:{role:'toolResult',toolName:'cbim_task_cancel',toolCallId:'tool-call',content:[{type:'text'}],isError:false,...extra}})+'\r\n',
    '{"id":"after","parentId":"broken","type":"message","message":{"role":"user","content":[{"type":"text","text":"继续"}]}}\r\n',
  ];
  const original=Buffer.from(lines.join(''));await fs.writeFile(sessionFile,original);
  return {root,sessions,sessionFile,lines,original,options:{sessionFile,recordId:'broken',toolCallId:'tool-call'}};
}

test('默认预览只返回元数据，不写入会话、备份或私人正文',async()=>{
  const f=await fixture(),result=await repairPiToolResult(f.options,idle);
  expect(result).toMatchObject({status:'would_repair',line:3,beforeSha256:sha256(f.original)});
  expect(result.afterSha256).not.toBe(result.beforeSha256);
  expect(await fs.readFile(f.sessionFile)).toEqual(f.original);
  expect(await fs.readdir(path.join(f.root,'pi'))).toEqual(['sessions']);
  expect(JSON.stringify(result)).not.toContain('synthetic private sample');
});

test('备份原字节并只替换指定工具结果，保留其他行和记录关联，二次执行幂等',async()=>{
  const f=await fixture(),preview=await repairPiToolResult(f.options,idle);
  const result=await repairPiToolResult({...f.options,apply:true,expectedSha256:preview.beforeSha256},idle);
  expect(result.status).toBe('repaired');expect(result.replayed).toBe(false);
  expect(await fs.readFile(result.backupFile!)).toEqual(f.original);
  expect(path.relative(f.sessions,result.backupFile!).startsWith('..'+path.sep)).toBe(true);
  const updated=await fs.readFile(f.sessionFile,'utf8'),lines=updated.split(/(?<=\n)/);
  expect([lines[0],lines[1],lines[3]]).toEqual([f.lines[0],f.lines[1],f.lines[3]]);
  const changed=JSON.parse(lines[2]);expect(changed).toMatchObject({id:'broken',parentId:'before',timestamp:'2026-11-06T10:39:47.076Z',message:{toolName:'cbim_task_cancel',toolCallId:'tool-call',isError:true}});
  expect(JSON.parse(changed.message.content[0].text)).toMatchObject({error:{code:'LEGACY_TOOL_RESULT_INVALID'},recovery:{recordId:'broken',toolCallId:'tool-call',replayed:false}});
  expect(changed.message.content[0].text).not.toContain('TASK_NOT_FOUND');
  expect(sha256(Buffer.from(updated))).toBe(result.afterSha256);
  expect(JSON.parse(await fs.readFile(path.join(path.dirname(result.backupFile!),'receipt.json'),'utf8'))).toMatchObject({beforeSha256:preview.beforeSha256,afterSha256:result.afterSha256,changedRecordIds:['broken'],status:'repaired'});
  const again=await repairPiToolResult({...f.options,apply:true,expectedSha256:preview.beforeSha256},idle);
  expect(again.status).toBe('already_repaired');expect(await fs.readFile(f.sessionFile,'utf8')).toBe(updated);
  expect(await fs.readdir(path.join(f.root,'pi','session-repair-backups'))).toHaveLength(1);
});

test('未匹配记录、其他异常块和非预期故障拒绝修改',async()=>{
  const f=await fixture();
  await expect(repairPiToolResult({...f.options,recordId:'missing'},idle)).rejects.toThrow('目标记录');
  await expect(repairPiToolResult({...f.options,toolCallId:'other'},idle)).rejects.toThrow('不一致');
  await fs.appendFile(f.sessionFile,JSON.stringify({type:'message',id:'other',message:{role:'toolResult',content:[{type:'text'}]}})+'\n');
  const before=await fs.readFile(f.sessionFile);
  await expect(repairPiToolResult(f.options,idle)).rejects.toThrow('其他异常');expect(await fs.readFile(f.sessionFile)).toEqual(before);
  const valid=await fixture({content:[{type:'text',text:'valid'}]});
  await expect(repairPiToolResult(valid.options,idle)).rejects.toThrow('不符合');expect(await fs.readFile(valid.sessionFile)).toEqual(valid.original);
});

test('应用运行、缺少预览哈希和过期预览均拒绝写入',async()=>{
  const f=await fixture(),preview=await repairPiToolResult(f.options,idle);
  await expect(repairPiToolResult({...f.options,apply:true},idle)).rejects.toThrow('预览哈希');
  await expect(repairPiToolResult({...f.options,apply:true,expectedSha256:'0'.repeat(64)},idle)).rejects.toThrow('预览哈希');
  await expect(repairPiToolResult({...f.options,apply:true,expectedSha256:preview.beforeSha256},{assertIdle:async()=>{throw Error('CBIM 仍在运行')}})).rejects.toThrow('仍在运行');
  expect(await fs.readFile(f.sessionFile)).toEqual(f.original);expect(await fs.readdir(path.join(f.root,'pi'))).toEqual(['sessions']);
});

test('备份后的并发变更不会被覆盖，原始备份和准备回执保留',async()=>{
  const f=await fixture(),preview=await repairPiToolResult(f.options,idle);let checks=0;
  const concurrent=Buffer.concat([f.original,Buffer.from('\n')]);
  await expect(repairPiToolResult({...f.options,apply:true,expectedSha256:preview.beforeSha256},{assertIdle:async()=>{if(++checks===2)await fs.writeFile(f.sessionFile,concurrent)}})).rejects.toThrow('备份后发生变化');
  expect(await fs.readFile(f.sessionFile)).toEqual(concurrent);
  expect((await fs.readdir(f.sessions)).filter(name=>name!==path.basename(f.sessionFile))).toEqual([]);
  const backups=await fs.readdir(path.join(f.root,'pi','session-repair-backups'));
  const backupRoot=path.join(f.root,'pi','session-repair-backups',backups[0]);
  expect(await fs.readFile(path.join(backupRoot,'original.jsonl.backup'))).toEqual(f.original);
  expect(JSON.parse(await fs.readFile(path.join(backupRoot,'manifest.json'),'utf8')).status).toBe('prepared');
});

test('损坏 JSON 不泄露正文，不做猜测修复',async()=>{
  const f=await fixture();await fs.writeFile(f.sessionFile,'{"secret":"synthetic-private');
  const before=await fs.readFile(f.sessionFile);
  await expect(repairPiToolResult(f.options,idle)).rejects.toThrow('不是有效 JSON');
  expect(await fs.readFile(f.sessionFile)).toEqual(before);
});
