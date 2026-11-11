import {expect,test} from 'vitest';
import {mainAgentId,mainAgentInstructions,mainInstructions,collaborationInstructions} from '../src/backend/scheduler-engine/conversation/main-agent';
import {loopInstructions} from '../src/backend/scheduler-engine/context/team-workflow';

test('Team 及旧无模式主会话直接执行默认模块，自定义派发保留角色边界',()=>{
  expect(mainAgentId).toBe('cbim:main');
  for(const required of ['当前主会话的唯一调度 Agent','对于业务生产，每个模块未指定自定义 Agent 时默认由你在当前主会话实现','真实业务模块','Team 成员','cbim:executor','cbim_dispatch_task','cbim_dispatch_inspect','结束本轮让调度引擎继续执行','核实真实回执','可靠调度及运行/工具事件'])expect(mainAgentInstructions).toContain(required);
  expect(mainAgentInstructions).not.toContain('cbim_dispatch_self');
  expect(mainAgentInstructions).not.toContain('不声称存在尚未实现的多 Agent 委派能力');
});

test('主会话可直接管理团队和业务知识，但保留授权、版本事务与业务执行边界',()=>{
  for(const required of ['团队与业务知识管理者','通过 cbim_ 知识服务直接增删改查 .cbim/','不要求这些知识治理操作先委派执行者','read 仅允许查询和预览','ask 的知识写入须经当前工具审批','execute 也必须通过实际写入门禁、版本核验、Schema 检查和原子事务','不用原生工具直接读写','未配置自定义负责岗位的业务产物由你直接实现和验证'])expect(mainAgentInstructions).toContain(required);
  expect(mainAgentInstructions).not.toContain('需要修改知识或其他产物时同样交给执行者处理');
});

test('团队与技术管理者把工程架构职责转为可核实的任务和治理行为',()=>{
  for(const required of ['工程思维、架构思维和结构化思维','核实现状、目标与约束','维护模块职责、依赖边界和维护责任','执行者、目标模块列表、任务目标与验收证据要求','明确依赖、风险和未知项','审阅交付候选与验收证据','安排返工或后续任务','架构演进基于证据渐进推进','重大治理决策交给人','不凭模型判断宣称人工审核或验收通过','不能绕过实际工具、权限、版本事务或人工决策规则'])expect(mainAgentInstructions).toContain(required);
});

test.each(['auto','team'] as const)('两种模式都提示主 Agent 默认执行且不虚构成员任务 (%s)',mode=>{
  const text=mainInstructions(mode)+collaborationInstructions(mode);expect(text).toContain('当前会话直接执行');expect(text).toContain('不存在内置默认执行员');expect(text).toContain('read/ask/execute');expect(text).not.toContain('主 Agent 永远只调度');
  expect(text).toContain('独立成员 assignee');expect(text).toContain('main-execution');
  expect(text).not.toContain('禁止把 cbim:main 作为业务执行角色');
  expect(text).not.toContain('不能自行完成正式业务任务');
});

test('原单模块入口同样自主执行但不调度，状态和协作能力依赖真实事件与工具',()=>{
  for(const required of ['执行 Agent','主 Agent 可直接实现与验证未配置自定义 Agent 的模块','也可经受控知识服务治理团队与业务架构','read/ask/execute 权限内，通过审批、版本核验及事务','主动探索真实 Team 环境与目标模块','报告给主调度 Agent','不通过正文自称改变状态','未提供成员间派发、等待或通信工具'])expect(loopInstructions).toContain(required);
  for(const tool of ['cbim_task_plan','cbim_task_step','cbim_task_inspect','cbim_delivery_prepare'])expect(loopInstructions).toContain(tool);
});
test.each(['auto','team'] as const)('主 Agent %s 模式在正文交付最终反馈，不能以状态或工具替代',mode=>{
  const text=mainInstructions(mode);expect(text).toContain('每轮结束前在对话正文给出简短最终反馈');expect(text).toContain('未知写入不得为总结而重放');expect(text).not.toContain('不追加成功消息');
});
