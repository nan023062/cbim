import {it,expect} from 'vitest';
import {executionScopeSchema,executionScopeCovers,preparedExecutionScope,type ExecutionScope} from '../src/backend/core/workspace/execution-scope';
import {workflowContractSchema} from '../src/backend/core/workspace/workflow-contract';
import {scopedNodeInputSchema} from '../src/backend/core/tasks/scoped-execution';
export const scopeFixture:ExecutionScope={version:1,profile:'windows-lpac-node-v1',read:[{path:'src',kind:'directory'},{path:'result.txt',kind:'file'}],write:[{path:'result.txt',kind:'file'}],node:{timeoutMs:3000,memoryMiB:512,processLimit:2}};
it('范围只有明确相对文件/目录；写必须是读的子集，拒绝私有目录、跳转、设备和别名',()=>{
 expect(executionScopeSchema.parse(scopeFixture)).toEqual(scopeFixture);
 for(const path of ['../secret','.cbim/x','src/.git/config','C:/secret','src/CON.txt','src/a.','src/x:stream','src//x','src/../secret','src/*','src\\x'])expect(executionScopeSchema.safeParse({...scopeFixture,read:[{path,kind:'file'}],write:[]}).success,path).toBe(false);
 expect(executionScopeSchema.safeParse({...scopeFixture,write:[{path:'result.txt',kind:'directory'}]}).success).toBe(false);
 expect(executionScopeCovers(scopeFixture.read,'src/a.cjs')).toBe(true);expect(executionScopeCovers(scopeFixture.read,'src-other/a')).toBe(false);expect(executionScopeCovers(scopeFixture.read,'result.txt/x')).toBe(false);
});
it('缺省保持旧行为；混合模块、越界出口及原生证据不能静默回退，预算取共同下限',()=>{
 expect(preparedExecutionScope([{},{}])).toBeUndefined();expect(()=>preparedExecutionScope([{contract:{executionScope:scopeFixture}},{}])).toThrow('MIXED');
 const base={version:1,executionScope:scopeFixture};
 expect(workflowContractSchema.safeParse({...base,delivery:{requiredToolEvidence:[{id:'read',toolName:'read'}]}}).success).toBe(false);
 expect(workflowContractSchema.safeParse({...base,artifactScope:{version:1,roots:[{path:'secret',kind:'directory'}]}}).success).toBe(false);
 expect(workflowContractSchema.safeParse({...base,delivery:{requiredValidations:[{id:'json',validator:'json-schema-v1',artifactPath:'secret',schema:{type:'object'}}]}}).success).toBe(false);
 const second={...scopeFixture,node:{timeoutMs:1000,memoryMiB:256,processLimit:1}};expect(preparedExecutionScope([{contract:{executionScope:scopeFixture}},{contract:{executionScope:second}}])?.node).toEqual(second.node);
 const noNode={...scopeFixture,node:undefined};expect(preparedExecutionScope([{contract:{executionScope:scopeFixture}},{contract:{executionScope:noNode}}])?.node).toBeUndefined();
 expect(()=>preparedExecutionScope([{contract:{executionScope:scopeFixture,delivery:{requiredToolEvidence:[{toolName:'cbim_scoped_node'}]}}},{contract:{executionScope:noNode}}])).toThrow('NODE');
});
it('程序请求不能覆盖预算、解释器、环境或原工程路径，入口须属于唯一快照',()=>{
 const input={entry:'src/main.cjs',files:['src/main.cjs'],args:[],outputs:['out.json']};expect(scopedNodeInputSchema.safeParse(input).success).toBe(true);
 for(const extra of [{timeoutMs:30000},{executable:'cmd.exe'},{env:{SECRET:'x'}},{cwd:'C:/'},{files:['other.cjs']},{files:['src/main.cjs','src/MAIN.cjs']},{outputs:['../out']}])expect(scopedNodeInputSchema.safeParse({...input,...extra}).success).toBe(false);
});
