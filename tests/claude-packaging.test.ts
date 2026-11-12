import {expect,test} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import {packageClaudeRuntime} from '../scripts/package-pi-runtime.mjs';
import {loadClaudeSdk} from '../src/backend/engines/claude/sdk';

test('Claude runtime copy includes the SDK, current platform binary and resolvable peer dependencies',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-cc-package-')),runtime=path.join(root,'claude-runtime'),original=(process as any).resourcesPath;
  try{
    await packageClaudeRuntime(runtime);const require=createRequire(path.join(runtime,'package.json')),entry=require.resolve('@anthropic-ai/claude-agent-sdk');
    (process as any).resourcesPath=root;
    expect(entry.startsWith(runtime+path.sep)).toBe(true);expect(typeof (await loadClaudeSdk()).query).toBe('function');
    const manifest=JSON.parse(await fs.readFile(path.join(runtime,'manifest.json'),'utf8')),versions=manifest.packages.map((p:any)=>p.version);
    expect(versions).toContain('@anthropic-ai/claude-agent-sdk@0.3.322');expect(versions.some((s:string)=>s.startsWith('@anthropic-ai/claude-agent-sdk-'+process.platform+'-'+process.arch+'@'))).toBe(true);
    expect(require.resolve('zod/v4').startsWith(root+path.sep)).toBe(true);expect(require.resolve('@modelcontextprotocol/sdk/server/mcp.js').startsWith(root+path.sep)).toBe(true);
  }finally{if(original===undefined)delete (process as any).resourcesPath;else (process as any).resourcesPath=original;if(path.dirname(root)!==path.resolve(os.tmpdir())||!path.basename(root).startsWith('cbim-cc-package-'))throw Error('unexpected cleanup');await fs.rm(root,{recursive:true,force:true})}
},60000);
