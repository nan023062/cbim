import {test,expect} from 'vitest';
import {initialLayout,mergeConversations} from '../src/frontend/shell/tabs';
import {fixture} from './helpers';
import fs from 'node:fs/promises';
test('sidebar migration preserves drafts and active conversation, restores history without duplicate tasks',()=>{
 const l=initialLayout();l.tabs[0].draft='尚未发送';l.tabs[0].taskId='old';
 const records=[{task:{taskId:'old',goal:'旧对话',mode:'chat'}},{task:{taskId:'new',goal:'新增任务\n附件正文',mode:'chat'}}];
 const merged=mergeConversations(l,records)!;expect(merged.active).toBe(l.active);expect(merged.tabs[0].draft).toBe('尚未发送');expect(merged.tabs.map(t=>t.title)).toEqual(['旧对话','新增任务']);expect(mergeConversations(merged,records)).toBe(merged);
});
test('project rename is persistent display-only, removal does not remove project files',async()=>{
 const f=await fixture(false);try{const entry=await f.app.dispatch('add',{path:f.a});await f.app.dispatch('rename',{id:entry.id,name:'设计团队'});expect((await f.app.list()).entries[0]).toMatchObject({id:entry.id,path:entry.path,name:'设计团队'});expect((await f.app.catalog.read()).entries[0].name).toBe('设计团队');await expect(f.app.dispatch('rename',{id:entry.id,name:'\n'})).rejects.toThrow();await f.app.remove(entry.id);await expect(fs.stat(f.a)).resolves.toBeDefined();expect((await f.app.list()).entries).toHaveLength(0)}finally{await f.cleanup()}
});
