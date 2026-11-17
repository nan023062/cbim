// logic/workspace/service: module-owned integration coverage; keep the original scenario and cleanup semantics.
import {test,expect} from 'vitest';
import {initialLayout,mergeConversations} from '../../../../../src/view/shell/tabs';
import {fixture} from '../../application/support/helpers';
import fs from 'node:fs/promises';
test('project rename is persistent display-only, removal does not remove project files',async()=>{
 const f=await fixture();try{const entry=await f.app.Dispatch('add',{path:f.a});await f.app.Dispatch('rename',{id:entry.id,name:'设计团队'});expect((await f.app.List()).entries[0]).toMatchObject({id:entry.id,path:entry.path,name:'设计团队'});expect((await f.app.catalog.Read()).entries[0].name).toBe('设计团队');await expect(f.app.Dispatch('rename',{id:entry.id,name:'\n'})).rejects.toThrow();await f.app.Remove(entry.id);await expect(fs.stat(f.a)).resolves.toBeDefined();expect((await f.app.List()).entries).toHaveLength(0)}finally{await f.cleanup()}
});
