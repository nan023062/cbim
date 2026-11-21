/**
 * 作用定位：Agent 任务步骤契约与分析、分解、执行、汇总的编排函数。
 * 设计原因：通过显式派发端口连接办公室；缺少执行条件时返回待处理结果，不把任务规划当作完成。
 */
import { readRoleSkill, type AgentDefinition } from './description';

import type { AgentRole, OfficeObservation } from './agent';

/** 分解阶段显式选择自己执行或交给办公室中的某个岗位。 */
export type AgentStep = |
{
  kind: 'local';

  task: string;

  skillIds?: readonly string[]
} |
{
  kind: 'forward';

  task: string;

  memberId: string
};

export interface AgentStepResult
{
  readonly step: AgentStep;

  readonly output: string;
}

/** 实际模型和工具由调用方绑定到角色；每次调用独立保存步骤结果。 */
export interface AgentTaskExecution
{
  Analyze(agent: AgentRole, task: string): Promise<string>;

  Decompose(analysis: string, environment: OfficeObservation | undefined, role: AgentDefinition): Promise<readonly AgentStep[]>;

  Execute(step: Extract<AgentStep, { kind: 'local' }>, previous: readonly AgentStepResult[], role: AgentDefinition, skills: NonNullable<AgentDefinition['effectiveSkills']>): Promise<string>;

  Summarize(task: string, analysis: string, results: readonly AgentStepResult[], role: AgentDefinition): Promise<string>;
}

/** 返回值代表该岗位完成后的输出；办公室实现负责调度和等待。 */
export interface AgentTaskDispatcher
{
  Forward(caller: AgentRole, step: Extract<AgentStep, { kind: 'forward' }>): Promise<string>;
}

export type AgentTaskResult = |
{
  status: 'completed';

  conclusion: string;

  results: readonly AgentStepResult[]
} |
{
  status: 'blocked';

  reason: 'dispatcher_unavailable';

  remaining: readonly AgentStep[];

  results: readonly AgentStepResult[]
};

export async function runAgentTask(agent: AgentRole, task: string, execution: AgentTaskExecution, dispatcher?: AgentTaskDispatcher): Promise<AgentTaskResult>
{
  const analysis = await execution.Analyze(agent, task);

  const environment = await agent.Observe?.();

  const steps = await execution.Decompose(analysis, environment, agent.definition);

  const results: AgentStepResult[] = [];

  for (const step of steps)
  {
    let output: string;

    if (step.kind === 'forward')
    {
      if (!dispatcher)
        return { status: 'blocked', reason: 'dispatcher_unavailable', remaining: steps.slice(results.length), results };

      output = await dispatcher.Forward(agent, step);
    }
    else
    {
      const skills = (step.skillIds ?? []).map(id => readRoleSkill(agent.definition, id));

      output = await execution.Execute(step, results, agent.definition, skills);
    }

    results.push({ step, output });
  }

  const conclusion = await execution.Summarize(task, analysis, results, agent.definition);

  return { status: 'completed', conclusion, results };
}
