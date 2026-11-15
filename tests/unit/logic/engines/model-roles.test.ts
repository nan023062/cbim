import {expect,test} from 'vitest';
import {additionalRoleOperations,modelRolesSelectionSchema,modelRolesMatch,type ModelRoleDescriptor,type ModelRolesSelection} from '../../../../src/logic/engines';

const profileId='a0b587f0-b7e3-4daf-9adf-9cd7c8bd9166';
const embedding={kind:'embedding' as const,profileId,modelId:'embed'};
const declarations:ModelRoleDescriptor[]=[{id:'memory',label:'记忆向量',kind:'embedding',required:true,modelIds:['embed']},{id:'review',label:'复核',kind:'generation',required:false,connection:{supportedApis:['openai-responses']}}];

test('额外角色按静态声明确定能力、必填及型号，不因用户字段顺序改变执行顺序',()=>{
  const selection:ModelRolesSelection={version:2,roles:{review:{kind:'generation',profileId,modelId:'reviewer'},memory:embedding}};
  expect(additionalRoleOperations(declarations,selection)).toEqual([
    {slot:'memory',...embedding},{slot:'review',...selection.roles.review,connection:{supportedApis:['openai-responses']}},
  ]);
  expect(()=>additionalRoleOperations(declarations,undefined)).toThrow('请配置模型角色');
  expect(()=>additionalRoleOperations([],selection)).toThrow('引擎未声明');
  expect(()=>additionalRoleOperations(declarations,{version:2,roles:{memory:{...embedding,kind:'generation'}}})).toThrow('能力不匹配');
  expect(()=>additionalRoleOperations(declarations,{version:2,roles:{memory:{...embedding,modelId:'unlisted'}}})).toThrow('不支持所选型号');
});

test('V2 不复制 primary，不接受任意凭据或未知版本，历史缺省保持缺省',()=>{
  expect(modelRolesSelectionSchema.safeParse({version:1,roles:{}}).success).toBe(false);
  for(const slot of ['primary','constructor','prototype','__proto__'])expect(modelRolesSelectionSchema.safeParse({version:2,roles:{[slot]:embedding}}).success).toBe(false);
  expect(modelRolesSelectionSchema.safeParse({version:2,roles:{memory:{...embedding,apiKey:'secret'}}}).success).toBe(false);
  expect(modelRolesMatch(undefined,undefined)).toBe(true);
  expect(modelRolesMatch(undefined,{version:2,roles:{}})).toBe(false);
  expect(modelRolesMatch({version:2,roles:{}},{version:2,roles:{}})).toBe(true);
  expect(modelRolesMatch({version:2,roles:{memory:embedding}},{version:2,roles:{}})).toBe(false);
});
