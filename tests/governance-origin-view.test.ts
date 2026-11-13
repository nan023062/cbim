import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it} from 'vitest';
import {GovernanceOrigin} from '../src/view/governance/GovernanceOrigin';

it('旧记录没有来源时不补造本机身份或人工批准',()=>{
  const html=renderToStaticMarkup(createElement(GovernanceOrigin,{}));
  expect(html).toContain('历史记录未保存来源');expect(html).not.toContain('来源：本机明确提交');expect(html).not.toContain('<button');
});
it('本机提交与批准含义分开',()=>{
  const html=renderToStaticMarkup(createElement(GovernanceOrigin,{origin:{kind:'local_desktop',interaction:'explicit_submit'}}));
  expect(html).toContain('来源：本机明确提交');expect(html).toContain('不代表账号认证或已获批准');expect(html).not.toContain('主实例');
});
it('主运行显示完整真实来源并转义文本，不提供恢复或批准动作',()=>{
  const origin={kind:'main_agent' as const,rootSessionId:'root-original',agentInstanceId:'main-instance',agentSessionId:'member-channel',runId:'run-original',toolCallId:'call-<script>alert(1)</script>',toolName:'cbim_governance_propose' as const};
  const html=renderToStaticMarkup(createElement(GovernanceOrigin,{origin}));
  for(const id of ['root-original','main-instance','member-channel','run-original','cbim_governance_propose'])expect(html).toContain(id);
  expect(html).toContain('尚不构成人工决定');expect(html).toContain('&lt;script&gt;');expect(html).not.toContain('<script>');expect(html).not.toContain('<button');
});
