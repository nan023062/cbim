import {expect,it} from 'vitest';
import {generationBudgetModelSchema,embeddingBudgetModelSchema} from '../../../../../src/logic/budget/rules/model-request-budget';

const identity={profileId:'profile',modelId:'model',configurationHash:'a'.repeat(64)};
const bindingHash='b'.repeat(64);
const generation={...identity,api:'openai-responses',contextWindow:8192,maxTokens:1024};
const embedding={...identity,api:'openai-embeddings',inputTokens:1024,dimensions:1536};

it('budget roles reject reserved object keys while accepting ordinary role identities',()=>{
  for(const [schema,model] of [[generationBudgetModelSchema,generation],[embeddingBudgetModelSchema,embedding]] as const){
    expect(schema.safeParse({...model,role:{slot:'review',bindingHash}}).success).toBe(true);
    for(const slot of ['primary','constructor','prototype','__proto__']){
      expect(schema.safeParse({...model,role:{slot,bindingHash}}).success,slot).toBe(false);
    }
  }
});
