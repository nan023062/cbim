import {expect,it} from 'vitest';
import {feedbackInputSchema,feedbackIssue,githubFeedbackScopeSchema,githubFeedbackConfigSchema} from '../src/logic/feedback';

it('正文规范化保留已知事实，省略与空白具有相同结果',()=>{
  const input=feedbackInputSchema.parse({kind:'bug',summary:'  窗口\n图标  ',actual:'已经确认',extra:' '});
  if(input.kind!=='bug')throw Error('unexpected feedback kind');
  const expected={title:'[BUG] 窗口 图标',body:'## 问题\n\n窗口\n图标\n\n## 复现步骤\n\n用户未提供\n\n## 实际结果\n\n已经确认\n\n## 预期结果\n\n用户未提供\n\n## 环境\n\n用户未提供'};
  expect(feedbackIssue(input)).toEqual(expected);
  expect(feedbackIssue({...input,steps:' ',expected:'用户未提供',environment:''})).toEqual(expected);
});
it('输入拒绝保留标记、未知字段和空简述，不替用户补事实',()=>{
  for(const patch of [{summary:' '},{extra:'<!-- cbim-feedback:fake -->'},{repo:'other'}])expect(feedbackInputSchema.safeParse({kind:'wish',summary:'批量导出',...patch}).success).toBe(false);
  expect(feedbackInputSchema.safeParse({kind:'wish',summary:'批量导出'}).success).toBe(true);
});
it('可信范围保持原字段形状与严格校验，配置不接受令牌',()=>{
  const scope={kind:'github-feedback',workspaceId:'',connectionId:'11111111-1111-4111-8111-111111111111',repositoryId:99,owner:'owner',repo:'repo'};
  expect(githubFeedbackScopeSchema.parse(scope)).toEqual(scope);
  for(const patch of [{repositoryId:0},{token:'secret'},{connectionId:'invalid'}])expect(githubFeedbackScopeSchema.safeParse({...scope,...patch}).success).toBe(false);
  const config={clientId:'client_123',owner:'owner',repo:'repo',visibility:'public',autoSubmit:true};
  expect(githubFeedbackConfigSchema.safeParse(config).success).toBe(true);
  expect(githubFeedbackConfigSchema.safeParse({...config,token:'secret'}).success).toBe(false);
});
