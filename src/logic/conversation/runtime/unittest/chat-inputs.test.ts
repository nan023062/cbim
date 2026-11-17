// logic/conversation/runtime: module-owned integration coverage; keep the original scenario and cleanup semantics.
import {it,expect} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {fixture} from '../../../application/unittest/support/helpers';
import {ChatInputs} from '../../../materials/service/chat-inputs';
import {transcript} from '../../../../view/execution-view/transcript';

it.each(['message','images'] as const)('recursive conversation %s validates every saved attachment before sending',async method=>{
 const f=await fixture();try{
  const entry=await f.app.Dispatch('add',{path:f.a}),inputs=new ChatInputs(f.app.Workspace(entry.id));
  const file=path.join(f.a,'guard.txt');await fs.writeFile(file,'ORIGINAL_REFERENCE');
  const item=await inputs.Path('file',file),snapshot=path.join(f.app.paths.Project(entry.id),'chat-inputs',item.id+'.json');
  const saved=JSON.parse(await fs.readFile(snapshot,'utf8'));
  const call=(ids:string[])=>method==='message'?inputs.Message('supplement',ids):inputs.Images(ids);
  await expect(call([item.id,item.id])).rejects.toMatchObject({code:'GOAL_ATTACHMENT_INPUT'});
  for(const invalid of ['{',JSON.stringify({...saved,id:'00000000-0000-4000-8000-000000000000'}),JSON.stringify({...saved,text:{untrusted:'object'}}),JSON.stringify({...saved,kind:'folder'}),JSON.stringify({...saved,image:{type:'image',mimeType:'image/png',data:'YQ=='}})]){
   await fs.writeFile(snapshot,invalid);await expect(call([item.id])).rejects.toMatchObject({code:'GOAL_ATTACHMENT_INVALID'});
  }
  await fs.writeFile(snapshot,JSON.stringify(saved));await fs.writeFile(file,'CHANGED_SOURCE');
  if(method==='message'){expect(await call([item.id])).toContain('ORIGINAL_REFERENCE');expect(await call([item.id])).not.toContain('CHANGED_SOURCE')}
  else expect(await call([item.id])).toEqual([]);
  const foreign=await f.app.Dispatch('add',{path:f.b}),other=new ChatInputs(f.app.Workspace(foreign.id));
  await expect(method==='message'?other.Message('supplement',[item.id]):other.Images([item.id])).rejects.toMatchObject({code:'GOAL_ATTACHMENT_MISSING'});
 }finally{await f.cleanup()}
});
it('conversation materials keep source proof and reject oversized expanded messages',async()=>{
 const f=await fixture();try{
  const entry=await f.app.Dispatch('add',{path:f.a}),inputs=new ChatInputs(f.app.Workspace(entry.id));
  const folder=await inputs.Path('folder',f.a);expect(await inputs.Message('inspect',[folder.id])).toContain('"proof":');
  const file=path.join(f.a,'large.txt');await fs.writeFile(file,'x'.repeat(64000));const ids:string[]=[];
  for(let i=0;i<9;i++)ids.push((await inputs.Path('file',file)).id);
  await expect(inputs.Message('supplement',ids)).rejects.toMatchObject({code:'GOAL_ATTACHMENT_LIMIT'});
 }finally{await f.cleanup()}
});
