import {it,expect} from 'vitest';
import {initialLayout,newTab,moveTab,readLayouts,renameConversation,removeConversation,mergeConversations} from '../src/view/shell/tabs';
import {bindRuntimeConversation} from '../src/view/shell/runtime-navigation';
it('移动页签保持活动页签与草稿，不改变另一工作区',()=>{const first=initialLayout(),second=initialLayout(),flow=newTab('flow');first.tabs[0].draft='未发送草稿';first.tabs.push(flow);const moved=moveTab(first,flow.id,first.tabs[0].id);expect(moved.tabs.map(t=>t.kind)).toEqual(['flow','chat']);expect(moved.active).toBe(first.active);expect(moved.tabs[1].draft).toBe('未发送草稿');expect(second.tabs).toHaveLength(1);expect(first.tabs[0].kind).toBe('chat')});
it('恢复布局忽略坏记录、重复页签和未知类型，并恢复有效活动页签',()=>{const id='a'.repeat(64),t=newTab('chat');const result=readLayouts(JSON.stringify({[id]:{tabs:[t,t,{id:'unknown',kind:'unsafe',title:'x'}],active:'missing'},bad:{tabs:[]}}));expect(Object.keys(result)).toEqual([id]);expect(result[id].tabs).toHaveLength(1);expect(result[id].active).toBe(t.id);expect(readLayouts('{')).toEqual({})});

it('改名持久化且轮询不能用原任务目标覆盖；删除后轮询和重开不复活，草稿保持',()=>{
 const workspace='a'.repeat(64),records=[{task:{taskId:'one',mode:'chat',goal:'原目标'}},{task:{taskId:'two',mode:'chat',goal:'另一个'}}];
 const layout=mergeConversations(undefined,records)!;layout.tabs[1].draft='保留';
 const renamed=renameConversation(layout,layout.tabs[0].id,'新对话');expect(mergeConversations(renamed,records)!.tabs[0].title).toBe('新对话');
 const removed=removeConversation(renamed,layout.tabs[0].id),restored=readLayouts(JSON.stringify({[workspace]:removed}))[workspace];
 expect(mergeConversations(restored,records)?.tabs.map(tab=>tab.taskId)).toEqual(['two']);expect(restored.tabs[0].draft).toBe('保留');expect(restored.hiddenTaskIds).toEqual(['one']);
 const empty=removeConversation(restored,restored.tabs[0].id);expect(empty.tabs).toHaveLength(1);expect(empty.tabs[0].taskId).toBeUndefined();expect(empty.active).toBe(empty.tabs[0].id);
 const reopened=bindRuntimeConversation(empty,{target:{workspaceId:workspace,rootSessionId:'one'},workspace:{id:workspace,instanceId:'i',state:'running',name:'A',path:'root',tasks:[]},conversation:{taskId:'one',goal:'原目标'}});
 expect(reopened.hiddenTaskIds).toEqual(['two']);expect(reopened.tabs.at(-1)?.taskId).toBe('one');
});
