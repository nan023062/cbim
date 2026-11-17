import {it,expect} from 'vitest';
import {Agent} from '../agent';

it('freezes identity, permission and model selection without copying conversation messages',()=>{
  const model={engine:'pi',profileId:'profile',modelId:'model'},definition={id:'agent',name:'Agent',instructions:'role',permission:'read' as const,model},conversation={workspaceId:'workspace',taskId:'task'};
  const agent=new Agent(definition,conversation);definition.name='changed';conversation.taskId='other';model.modelId='changed';
  expect(agent.definition.name).toBe('Agent');expect(agent.conversation.taskId).toBe('task');expect(agent.definition.model?.modelId).toBe('model');expect(Object.isFrozen(agent.definition)).toBe(true);expect(Object.isFrozen(agent.definition.model)).toBe(true);
});
