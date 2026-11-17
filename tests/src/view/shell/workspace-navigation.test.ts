// view/shell: module-owned integration coverage; keep the original scenario and cleanup semantics.
import {test,expect} from 'vitest';
import {initialLayout,mergeConversations} from '../../../../src/view/shell/tabs';
import {fixture} from '../../logic/application/support/helpers';
import fs from 'node:fs/promises';
test('sidebar migration preserves drafts and active conversation, restores history without duplicate tasks',()=>{
 const l=initialLayout();l.tabs[0].draft='尚未发送';l.tabs[0].taskId='old';
 const records=[{task:{taskId:'old',goal:'旧对话',mode:'chat'}},{task:{taskId:'new',goal:'新增任务\n附件正文',mode:'chat'}}];
 const merged=mergeConversations(l,records)!;expect(merged.active).toBe(l.active);expect(merged.tabs[0].draft).toBe('尚未发送');expect(merged.tabs.map(t=>t.title)).toEqual(['旧对话','新增任务']);expect(mergeConversations(merged,records)).toBe(merged);
});
