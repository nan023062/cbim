import {test,expect} from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {MessageQueue} from '../src/logic/conversation/runtime/message-queue';
import {QueueProjection} from '../src/view/conversation/queue-sync';
test('queue sends only changed entries and preserves unchanged UI identity across polls and sorting',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-queue-sync-'));try{
  const q=new MessageQueue(path.join(dir,'queue.json'));await q.Load();const view=new QueueProjection();view.Apply(q.Delta('t'));
  const a=await q.Add('t','A'.repeat(30000),{model:'m',provider:'p'}),b=await q.Add('t','B',{model:'m',provider:'p'});
  view.Apply(q.Delta('t',view.cursor));const previous=view.items,first=view.items[0],second=view.items[1];
  const same=q.Delta('t',view.cursor);expect(same.order).toBeUndefined();expect(same.upserts).toBeUndefined();expect(JSON.stringify(same).length).toBeLessThan(100);expect(view.Apply(same)).toBe(previous);
  await q.Move('t',b.id,a.id);const sorted=q.Delta('t',view.cursor);expect(sorted.upserts).toEqual([]);view.Apply(sorted);expect(view.items).toEqual([second,first]);expect(view.items[0]).toBe(second);
  await q.Edit('t',a.id,'edited',a.message);const edited=q.Delta('t',view.cursor);expect(edited.upserts).toHaveLength(1);expect(edited.upserts![0].item.id).toBe(a.id);view.Apply(edited);expect(view.items[0]).toBe(second);
  await q.Change('t',b.id,'remove');const deleted=q.Delta('t',view.cursor);expect(deleted.upserts).toEqual([]);view.Apply(deleted);expect(view.items.map(x=>x.id)).toEqual([a.id]);const current=view.items;expect(view.Apply(sorted)).toBe(current);
  const restored=new MessageQueue(path.join(dir,'queue.json'));await restored.Load();const reset=restored.Delta('t',view.cursor);expect(reset.reset).toBe(true);view.Apply(reset);expect(view.items[0].status).toBe('paused');
  expect(q.Delta('other').upserts).toEqual([]);
 }finally{await fs.rm(dir,{recursive:true,force:true})}
});
