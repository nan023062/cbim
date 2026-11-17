// logic/workspace/service: module-owned integration coverage; keep the original scenario and cleanup semantics.
import {it,expect} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fixture} from '../../../application/unittest/support/helpers';
import {request} from '../../../knowledge/rules/unittest/data/knowledge';
import {internalKnowledge} from '../../../tools/runtime/unittest/support/knowledge-tool-fixture';
import {exists} from '../../../../core/platform/node/files/index';
function child(mode:string,root:string,user:string){return new Promise<{code:number|null;output:string}>((resolve,reject)=>{const p=spawn(process.execPath,['--import','tsx','src/logic/workspace/service/unittest/support/process-child.ts',mode,root,user],{windowsHide:true});let output='';p.stdout.on('data',x=>output+=x);p.stderr.on('data',x=>output+=x);p.on('error',reject);p.on('exit',code=>resolve({code,output}))})}
it('跨进程工作区缓存更新合并',async()=>{const f=await fixture();try{const results=await Promise.all([child('catalog',f.a,f.user),child('catalog',f.b,f.user)]);for(const result of results)expect(result,result.output).toMatchObject({code:0});expect((await f.app.catalog.Read()).entries).toHaveLength(2)}finally{await f.cleanup()}});
