import {test,expect} from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {MessageQueue} from '../src/backend/scheduler-engine/conversation/message-queue';
import {QueueProjection} from '../src/frontend/conversation/queue-sync';
test('queue sends only changed entries and preserves unchanged UI identity across polls and sorting',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-queue-sync-'));try{
  const q=new MessageQueue(path.join(dir,'queue.json'));await q.load();const view=new QueueProjection();view.apply(q.delta('t'));
  const a=await q.add('t','A'.repeat(30000),{model:'m',provider:'p'}),b=await q.add('t','B',{model:'m',provider:'p'});
  view.apply(q.delta('t',view.cursor));const previous=view.items,first=view.items[0],second=view.items[1];
  const same=q.delta('t',view.cursor);expect(same.order).toBeUndefined();expect(same.upserts).toBeUndefined();expect(JSON.stringify(same).length).toBeLessThan(100);expect(view.apply(same)).toBe(previous);
  await q.move('t',b.id,a.id);const sorted=q.delta('t',view.cursor);expect(sorted.upserts).toEqual([]);view.apply(sorted);expect(view.items).toEqual([second,first]);expect(view.items[0]).toBe(second);
  await q.edit('t',a.id,'edited',a.message);const edited=q.delta('t',view.cursor);expect(edited.upserts).toHaveLength(1);expect(edited.upserts![0].item.id).toBe(a.id);view.apply(edited);expect(view.items[0]).toBe(second);
  await q.change('t',b.id,'remove');const deleted=q.delta('t',view.cursor);expect(deleted.upserts).toEqual([]);view.apply(deleted);expect(view.items.map(x=>x.id)).toEqual([a.id]);const current=view.items;expect(view.apply(sorted)).toBe(current);
  const restored=new MessageQueue(path.join(dir,'queue.json'));await restored.load();const reset=restored.delta('t',view.cursor);expect(reset.reset).toBe(true);view.apply(reset);expect(view.items[0].status).toBe('paused');
  expect(q.delta('other').upserts).toEqual([]);
 }finally{await fs.rm(dir,{recursive:true,force:true})}
});
