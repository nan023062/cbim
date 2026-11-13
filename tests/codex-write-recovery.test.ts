import {expect,test} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {CodexEngine} from '../src/backend/engines/codex/engine';
import {codexFixture} from './codex-fixture';

test('真实 Codex 长写入完整落盘，参数错误返回工具失败且原文件保留',async()=>{
  for(const invalid of [false,true]){
    const f=await codexFixture({tool:'write'});
    try{
      const target=path.join(f.cwd,'written.txt'),content='中文 long file\n'.repeat(20000);
      await fs.writeFile(target,'original');Object.assign(f.input,{content:invalid?42:content});
      await f.engine.start(f.context);
      expect(await f.engine.run('Write once, then report the actual result')).toEqual({status:'completed'});
      expect(await fs.readFile(target,'utf8')).toBe(invalid?'original':content);
      const results=f.events.filter(e=>e.type==='tool.finished');
      expect(results).toHaveLength(1);expect(results[0].data.isError).toBe(invalid);
      expect(f.calls).toHaveLength(1);expect(f.requests).toHaveLength(2);
    }finally{await f.cleanup()}
  }
},60000);

test('真实 Codex 长写入参数生成中断不覆盖旧文件，原会话可恢复且不重放',async()=>{
  const f=await codexFixture({tool:'write',incompleteTool:true});let resumed:CodexEngine|undefined;
  try{
    const target=path.join(f.cwd,'written.txt');await fs.writeFile(target,'original');
    Object.assign(f.input,{content:'中文 incomplete\n'.repeat(20000)});
    await f.engine.start(f.context);
    await expect(f.engine.run('Write once')).rejects.toThrow('max_output_tokens');
    await f.engine.close();
    expect(await fs.readFile(target,'utf8')).toBe('original');
    expect(f.calls).toHaveLength(0);expect(f.requests).toHaveLength(1);
    expect(f.events.some(e=>e.type==='tool.started')).toBe(false);
    const bound=f.events.find(e=>e.type==='session.bound'&&e.data.sessionFile);
    expect(bound).toBeDefined();
    resumed=new CodexEngine(f.engineOptions);
    await resumed.start({...f.context,runId:randomUUID(),sessionFile:String(bound!.data.sessionFile),nativeSessionId:String(bound!.data.sessionId)});
    expect(await resumed.run('Continue by explaining the interruption; do not rewrite')).toEqual({status:'completed'});
    expect(f.calls).toHaveLength(0);expect(f.requests).toHaveLength(2);
    expect(await fs.readFile(target,'utf8')).toBe('original');
  }finally{await resumed?.close();await f.cleanup()}
},60000);
