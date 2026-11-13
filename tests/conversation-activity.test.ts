import {expect,it} from 'vitest';
import {runningConversations} from '../src/view/conversation/conversation-activity';
import type {RuntimeSnapshot} from '../src/bridge/contracts/runtime';
it('主轮次与独立成员点亮原会话；已结束、不可用和无绑定记录不点亮',()=>{
 const snapshot={workspaces:[{workspaceId:'a',availability:'ready'},{workspaceId:'b',availability:'closed'}],runs:[
  {workspaceId:'a',status:'running',conversationBinding:{rootSessionId:'main'}},
  {workspaceId:'a',status:'running',memberBinding:{rootSessionId:'main'}},
  {workspaceId:'a',status:'running',memberBinding:{rootSessionId:'other'}},
  {workspaceId:'a',status:'completed',conversationBinding:{rootSessionId:'finished'}},
  {workspaceId:'b',status:'running',conversationBinding:{rootSessionId:'closed'}},
  {workspaceId:'a',status:'running'},
 ]} as RuntimeSnapshot;
 expect(runningConversations(snapshot)).toEqual({a:['main','other']});
});
