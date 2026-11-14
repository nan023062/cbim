import {expect,it} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ConversationEntries} from '../src/view/conversation/ConversationEntries';
import {MemberConversation} from '../src/view/conversation/MemberConversation';
import {teamConversations} from '../src/view/execution-view/team-conversations';
import {officeSession,officeGraph,officeTask,officeTime} from './team-conversation-fixture';

it('主会话保持可见，子角色独立折叠且只有查看入口',()=>{
  const html=renderToStaticMarkup(createElement(ConversationEntries,{items:[{id:'tab',title:'办公室',children:[{id:'worker-session',title:'建模员',running:true}]}],selected:'tab',selectedChild:'worker-session',onSelect:()=>{},onSelectChild:()=>{},onRename:()=>{},onRemove:()=>{}}));
  expect(html).toContain('aria-label="办公室"');expect(html).toContain('<details class="conversation-child">');expect(html).toContain('查看 建模员 的对话');expect(html).not.toContain('删除对话 建模员');expect(html).not.toContain('重命名对话 建模员');expect(html).toContain('成员正在执行');
});
it('成员只读审阅展示主 Agent 的派发和频道返回入口，只读取所选话题',()=>{
  const graph=officeGraph([officeTask('old','old-topic'),officeTask('current')]),member=teamConversations([officeSession()],graph)[0];
  const html=renderToStaticMarkup(createElement(MemberConversation,{member,graph,scopes:[{scopeId:'topic',status:'active',createdAt:officeTime,hasGoal:true,hasPlan:false,inputPreview:'当前话题',stamp:{scopeId:'topic',streamId:'scopes:graph',seq:1}}],active:true,onOpenChannel:()=>{},onSelectTask:()=>{}}));
  expect(html).toContain('主 Agent → 建模员');expect(html).toContain('只读工作审阅');expect(html).toContain('返回所属主频道补充需求');expect(html).not.toContain('<textarea');expect(html).toContain('搭建模块 current');expect(html).not.toContain('搭建模块 old');expect(html).toContain('主 Agent 已派发，等待执行');
});
