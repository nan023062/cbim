import {expect,test} from 'vitest';
import {mainAgentId,mainAgentInstructions} from '../src/backend/scheduler-engine/conversation/main-agent';
import {defaultExecutorId,defaultExecutorInstructions} from '../src/backend/scheduler-engine/context/default-executor';
import {loopInstructions} from '../src/backend/scheduler-engine/context/team-workflow';

test('主会话不执行业务，缺少自定义执行者时使用内置角色而不自行实现',()=>{
  expect(mainAgentId).toBe('cbim:main');
  for(const required of ['当前主会话的唯一调度 Agent','对于业务生产，主 Agent 永远只调度','真实业务模块','Team 成员','cbim:executor','cbim_dispatch_task','cbim_dispatch_inspect','结束本轮让调度引擎继续执行','核实真实回执','可靠调度及运行/工具事件'])expect(mainAgentInstructions).toContain(required);
  expect(mainAgentInstructions).not.toContain('cbim_dispatch_self');
  expect(mainAgentInstructions).not.toContain('不声称存在尚未实现的多 Agent 委派能力');
});

test('主会话可直接管理团队和业务知识，但保留授权、版本事务与业务执行边界',()=>{
  for(const required of ['团队与业务知识管理者','通过 cbim_ 知识服务直接增删改查 .cbim/','不要求这些知识治理操作先委派执行者','read 仅允许查询和预览','ask 的知识写入须经当前工具审批','execute 也必须通过实际写入门禁、版本核验、Schema 检查和原子事务','不用原生工具直接读写','业务产物的实现和验证交给执行者'])expect(mainAgentInstructions).toContain(required);
  expect(mainAgentInstructions).not.toContain('需要修改知识或其他产物时同样交给执行者处理');
});

test('团队与技术管理者把工程架构职责转为可核实的任务和治理行为',()=>{
  for(const required of ['工程思维、架构思维和结构化思维','核实现状、目标与约束','维护模块职责、依赖边界和维护责任','执行者、目标模块列表、任务目标与验收证据要求','明确依赖、风险和未知项','审阅交付候选与验收证据','安排返工或后续任务','架构演进基于证据渐进推进','重大治理决策交给人','不凭模型判断宣称人工审核或验收通过','不能绕过实际工具、权限、版本事务或人工决策规则'])expect(mainAgentInstructions).toContain(required);
});

test('默认执行角色是静态独立角色，不注入主会话派工指令',()=>{
  expect(defaultExecutorId).toBe('cbim:executor');expect(defaultExecutorInstructions).toContain('独立于主调度 Agent 的执行实例和会话');expect(defaultExecutorInstructions).toContain('不能派发或指挥其他成员');
  expect(defaultExecutorInstructions).toContain('自主探索、实现和验证');expect(defaultExecutorInstructions).toContain('由主调度 Agent 安排');expect(defaultExecutorInstructions).not.toMatch(/cbim_dispatch_task|cbim_dispatch_self/);
  for(const required of ['主 Agent 同时负责团队与业务知识管理','不代表主 Agent 会替你实现或验证业务产物','read/ask/execute 门禁、审批、版本核验和事务','不通过原生工具直接读写','任务外的团队或业务架构调整报告给主 Agent'])expect(defaultExecutorInstructions).toContain(required);
});

test('原单模块入口同样自主执行但不调度，状态和协作能力依赖真实事件与工具',()=>{
  for(const required of ['执行 Agent','cbim:main 不能执行业务','同时可经受控知识服务治理团队与业务架构','read/ask/execute 权限内，通过审批、版本核验及事务','主动探索真实 Team 环境与目标模块','报告给主调度 Agent','不通过正文自称改变状态','未提供成员间派发、等待或通信工具'])expect(loopInstructions).toContain(required);
  for(const tool of ['cbim_task_plan','cbim_task_step','cbim_task_inspect','cbim_delivery_prepare'])expect(loopInstructions).toContain(tool);
});
