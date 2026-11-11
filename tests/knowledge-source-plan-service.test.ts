import {it,expect,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fixture} from './helpers';
import {summary,request} from './data/knowledge';
import {ObjectCrud,type ObjectOperation} from '../src/backend/core/knowledge/object-crud';
import {hash,json} from '../src/backend/core/foundation/serialization';
import {Application} from '../src/backend/main/application';
import {Paths} from '../src/backend/main/platform/paths';
import type {Workspace} from '../src/backend/main/workspace/workspace';

const agent='.cbim/team/source_worker',principles='# Source\nPreserve real knowledge facts.';
const create: ObjectOperation={kind:'agent',action:'create',parentId:'.cbim/team',slug:'source_worker',data:{name:'Source worker',summary,capabilities:['Verify']},body:principles};
async function change(w:Workspace,operations:ObjectOperation[]){const s=await w.snapshot(),crud=new ObjectCrud(w),preview=await crud.preview(s.revision,operations);expect(preview.validation.structural,JSON.stringify(preview.validation.issues)).toBe(true);return {preview,result:await crud.commit(preview.planId)}}
async function setup(){const f=await fixture(),entry=await f.app.dispatch('add',{path:f.a}),w=f.app.workspace(entry.id);await change(w,[create,{kind:'skill',action:'create',parentId:'.cbim/team',slug:'audit',data:{name:'Audit',purpose:'Verify'},body:'# Audit'}]);return {...f,w,id:entry.id}}

it('one actual object plan retains delete/create intent when the recreated Agent bytes are unchanged',async()=>{
  const f=await setup();try{
    const before=await f.w.snapshot(),state=await f.w.dispatchStore.read(),old=state.knowledgeSourceGenerations!.find(g=>g.source.sourceId===agent&&!g.retired)!;
    const result=await change(f.w,[{kind:'agent',action:'delete',id:agent},create,{kind:'skill',action:'update',id:'.cbim/team/skills/audit',body:'# Audit\nActual independent difference.'}]);
    expect(result.preview.changes.some(c=>c.path.startsWith(agent+'/'))).toBe(false);
    expect((await f.w.snapshot()).files.filter(file=>file.path.startsWith(agent+'/'))).toEqual(before.files.filter(file=>file.path.startsWith(agent+'/')));
    const after=await f.w.dispatchStore.read(),next=after.knowledgeSourceGenerations!.find(g=>g.source.sourceId===agent&&!g.retired)!;
    expect(next.generationId).not.toBe(old.generationId);expect(next.origin).toBe('controlled_replace');expect(after.knowledgeSourceGenerations!.find(g=>g.generationId===old.generationId)!.retired?.reason).toBe('replaced');
    const bytes=await fs.readFile(path.join(f.user,f.id,'dispatch','dispatch.jsonl'));expect(await new ObjectCrud(f.w).commit(result.preview.planId)).toEqual(result.result);expect(await fs.readFile(path.join(f.user,f.id,'dispatch','dispatch.jsonl'))).toEqual(bytes);
  }finally{await f.cleanup()}
});

it('repairing an invalid tracked definition omitted from derived indexes does not invent a replacement',async()=>{
  const f=await setup();try{
    const before=await f.w.snapshot(),definition=before.files.find(file=>file.path===agent+'/agent.json')!,old=(await f.w.dispatchStore.read()).knowledgeSourceGenerations!.find(g=>g.source.sourceId===agent&&!g.retired)!;
    await fs.writeFile(path.join(f.a,definition.path),'{invalid definition','utf8');const invalid=await f.w.snapshot();expect(invalid.validation!.structural).toBe(false);expect(JSON.parse(invalid.validation!.indexes['.cbim/team/registry.json']).groups.flatMap((group:{agents:{id:string}[]})=>group.agents).map((value:{id:string})=>value.id)).not.toContain(agent);
    await f.w.commit(request(invalid,[{path:definition.path,text:definition.text}]));
    const after=await f.w.dispatchStore.read();expect(after.knowledgeSourceGenerations!.filter(g=>g.source.sourceId===agent)).toEqual([old]);expect((await f.w.snapshot()).validation!.structural).toBe(true);
  }finally{await f.cleanup()}
});

it('original request and nested change key order survive source journal replay without changing its old fingerprint',async()=>{
  const f=await setup();let app=f.app;try{
    const s=await f.w.snapshot(),original={changes:[{text:'# Actual request order',path:'.cbim/source-order.md'}],requestId:randomUUID(),revision:s.revision,instanceId:s.instanceId,workspaceId:s.workspaceId};
    const receipt=await f.w.commit(original),file=path.join(f.user,f.id,'transactions',original.requestId+'.json'),bytes=await fs.readFile(file);
    expect(JSON.parse(bytes.toString()).fingerprint).toBe(hash(json(original)));expect(await f.w.committedReceipt(original)).toEqual(receipt);
    await app.shutdown();app=new Application(new Paths(f.user,path.resolve('.')),path.resolve('design'));await app.init();expect(await app.workspace(f.id).committedReceipt(original)).toEqual(receipt);expect(await fs.readFile(file)).toEqual(bytes);
  }finally{await app.shutdown();await f.cleanup()}
});

it('raw knowledge input cannot smuggle plan authority and legacy uncommitted plans require a new preview',async()=>{
  const f=await setup();try{
    const s=await f.w.snapshot(),forged={...request(s,[{path:'.cbim/source-forged.md',text:'# Forbidden intent'}]),source:{resetRoots:['.cbim/team']}};
    await expect(f.w.commit(forged)).rejects.toMatchObject({code:'REQUEST_INVALID'});await expect(fs.stat(path.join(f.user,f.id,'transactions',forged.requestId+'.json'))).rejects.toMatchObject({code:'ENOENT'});
    const crud=new ObjectCrud(f.w),preview=await crud.preview(s.revision,[{kind:'agent',action:'update',id:agent,body:principles+'\nOld plan'}]);
    const file=path.join(f.user,f.id,'cache','object-plans',preview.planId+'.json'),saved=JSON.parse(await fs.readFile(file,'utf8'));
    await fs.writeFile(file,json({request:saved.request,hash:hash(json(saved.request)),deletedRoots:saved.deletedRoots}));
    await expect(crud.commit(preview.planId)).rejects.toMatchObject({code:'SOURCE_PLAN_INVALID'});expect((await f.w.read()).revision).toBe(s.revision);
  }finally{await f.cleanup()}
});

it('a prepared journal without proven Store admission blocks later same-instance writes until original recovery',async()=>{
  const f=await setup();try{
    const snapshot=await f.w.snapshot(),original=request(snapshot,[{path:agent+'/principles.md',text:principles+'\nPending'}]),blocked=request(snapshot,[{path:agent+'/principles.md',text:principles+'\nMust not overwrite before'}]);
    const spy=vi.spyOn(f.w.sources!,'prepare').mockRejectedValueOnce(new Error('before Store admission'));
    await expect(f.w.commit(original)).rejects.toThrow('before Store admission');spy.mockRestore();expect(f.w.state).toBe('recovery_required');
    await expect(f.w.commit(blocked)).rejects.toMatchObject({code:'NOT_RUNNING'});expect((await f.w.read()).revision).toBe(snapshot.revision);await expect(fs.stat(path.join(f.user,f.id,'transactions',blocked.requestId+'.json'))).rejects.toMatchObject({code:'ENOENT'});
    expect((await f.w.dispatchStore.read()).knowledgeSourceTransitions!.some(t=>t.requestId===original.requestId)).toBe(false);
  }finally{vi.restoreAllMocks();await f.cleanup()}
});

it('a known source transaction cannot become a legacy successful receipt by removing its journal marker',async()=>{
  const f=await setup();try{
    const s=await f.w.snapshot(),original=request(s,[{path:'.cbim/source-marker.md',text:'# Source marker'}]);await f.w.commit(original);
    const file=path.join(f.user,f.id,'transactions',original.requestId+'.json'),journal=JSON.parse(await fs.readFile(file,'utf8'));delete journal.source;await fs.writeFile(file,json(journal));
    const live=await f.w.read();await expect(f.w.committedReceipt(original)).rejects.toMatchObject({code:'SOURCE_JOURNAL_INVALID'});expect(await f.w.read()).toEqual(live);
  }finally{await f.cleanup()}
});
