import {expect,it} from 'vitest';
import {assertWorkflowCapabilities,parseWorkflowContract,workflowContractSchema,workflowContractLimits} from '../../../../../src/logic/workspace/rules/workflow-contract';

const contract={version:1,beforeEffects:{requirePlan:true},delivery:{requiredToolEvidence:[{id:'inspect-result',toolName:'read'}]}};
const block=(value:unknown,mark='```')=>mark+'cbim-workflow\n'+JSON.stringify(value)+'\n'+mark;
const invalid=(text:string)=>expect(()=>parseWorkflowContract(text)).toThrowError("Workflow 执行约定无效：");

it('无显式约定保留自然语言，不能从普通JSON/行内示例或其他代码块激活条件',()=>{
  for(const text of ['', '# 方法\n按专业判断验证。','行内 `cbim-workflow` 只表示名称。','```json\n'+JSON.stringify(contract)+'\n```','````markdown\n'+block(contract)+'\n````','> ```cbim-workflow\n> {}\n> ```','    ```cbim-workflow\n    {}\n    ```'])expect(parseWorkflowContract(text)).toBeUndefined();
});

it('只激活一个严格声明，支持标准围栏长度/换行/缩进并保留正文',()=>{
  const text='# 方法\n自由步骤。\n'+block(contract)+'\n更多说明。';expect(parseWorkflowContract(text)).toEqual(contract);expect(text).toContain('自由步骤');
  expect(parseWorkflowContract(block(contract,'~~~~'))).toEqual(contract);
  expect(parseWorkflowContract('\uFEFF'+block(contract).replaceAll('\n','\r\n'))).toEqual(contract);
  expect(parseWorkflowContract(block(contract,'````').split('\n').map(line=>'   '+line).join('\n'))).toEqual(contract);
  expect(parseWorkflowContract('```cbim-workflow\n'+JSON.stringify(contract)+'\n`````   ')).toEqual(contract);
});

it('两类条件可独立声明，但空条件、未知字段和非首版工具不能降级使用',()=>{
  expect(parseWorkflowContract(block({version:1,beforeEffects:{requirePlan:true}}))).toEqual({version:1,beforeEffects:{requirePlan:true}});
  for(const toolName of ['read','write','edit','grep','find','ls','bash'])expect(workflowContractSchema.safeParse({version:1,delivery:{requiredToolEvidence:[{id:'valid',toolName}]}}).success).toBe(true);
  for(const value of [{version:1},{version:2,beforeEffects:{requirePlan:true}},{...contract,unknown:true},{version:1,beforeEffects:{}},{version:1,beforeEffects:{requirePlan:false}},{version:1,beforeEffects:{requirePlan:true,steps:[]}},{version:1,delivery:{requiredToolEvidence:[]}},{...contract,delivery:{requiredToolEvidence:[{id:'verify',toolName:'cbim_knowledge_commit'}]}},{...contract,delivery:{requiredToolEvidence:[{id:'verify',toolName:'read',pass:true}]}}])invalid(block(value));
});

it('证据要求最多16项且ID安全唯一，不接受模型path/hash或表达式',()=>{
  const requirements=Array.from({length:16},(_,index)=>({id:'r'+index,toolName:'read'}));expect(workflowContractSchema.safeParse({version:1,delivery:{requiredToolEvidence:requirements}}).success).toBe(true);
  for(const list of [[...requirements,{id:'overflow',toolName:'read'}],[requirements[0],requirements[0]],[{id:'../escape',toolName:'read'}],[{id:'',toolName:'read'}],[{id:'x'.repeat(81),toolName:'read'}],[{id:'ok',toolName:'read',path:'secret'}],[{id:'ok',toolName:'read',sha256:'a'.repeat(64)}]])invalid(block({version:1,delivery:{requiredToolEvidence:list}}));
});

it('已声明的重复块、未闭合、额外标记和不匹配关闭均明确拒绝',()=>{
  invalid(block(contract)+'\n'+block(contract));
  for(const text of ['```cbim-workflow\n'+JSON.stringify(contract),'````cbim-workflow\n'+JSON.stringify(contract)+'\n```','~~~cbim-workflow\n'+JSON.stringify(contract)+'\n```','```cbim-workflow json\n'+JSON.stringify(contract)+'\n```','```CBIM-WORKFLOW\n'+JSON.stringify(contract)+'\n```','```cbim-workflow {#id}\n'+JSON.stringify(contract)+'\n```'])invalid(text);
  // 已关闭的示例块不遮蔽后面的真实声明。
  expect(parseWorkflowContract('````md\n'+block({version:2})+'\n````\n'+block(contract))).toEqual(contract);
});

it('严格JSON拒绝重复字段/注释/尾逗号，条件块按UTF-8字节有界',()=>{
  for(const source of ['', '{', 'null','[]','{"version":1,"version":1,"beforeEffects":{"requirePlan":true}}','{"version":1,/* comment */"beforeEffects":{"requirePlan":true}}','{"version":1,"beforeEffects":{"requirePlan":true},}'])invalid('```cbim-workflow\n'+source+'\n```');
  invalid('```cbim-workflow\n'+' '.repeat(workflowContractLimits.blockBytes)+JSON.stringify(contract)+'\n```');
});

it('启动能力按可信工具集合拒绝缺失工具，无声明保持旧入口可用',()=>{
 expect(()=>assertWorkflowCapabilities([],{artifacts:false})).not.toThrow();
 const bindings=[{contract:workflowContractSchema.parse(contract)}];
 expect(()=>assertWorkflowCapabilities(bindings,{artifacts:false})).toThrowError("本次引擎未提供可信工具能力清单");
 expect(()=>assertWorkflowCapabilities(bindings,{availableTools:[],artifacts:false})).toThrowError("当前权限或引擎未提供 Workflow 必需工具：");
 expect(()=>assertWorkflowCapabilities(bindings,{availableTools:['read'],artifacts:false})).not.toThrow();
 const write=[{contract:workflowContractSchema.parse({version:1,delivery:{requiredToolEvidence:[{id:'write',toolName:'write'}]}})}];
 expect(()=>assertWorkflowCapabilities(write,{availableTools:['read'],artifacts:true})).toThrowError("当前权限或引擎未提供 Workflow 必需工具：");
 expect(()=>assertWorkflowCapabilities(write,{availableTools:['read','write'],artifacts:true})).not.toThrow();
});
it('启动结构验证同时要求实际验证器和文件端口，并保留总量上限',()=>{
 const binding={contract:workflowContractSchema.parse({version:1,delivery:{requiredValidations:[{id:'json',validator:'json-schema-v1',artifactPath:'result.json',schema:{type:'object'}}]}})};
 const actual={availableTools:[],availableValidators:['json-schema-v1'],artifacts:true};
 expect(()=>assertWorkflowCapabilities([binding],actual)).not.toThrow();
 expect(()=>assertWorkflowCapabilities([binding],{...actual,artifacts:false})).toThrowError("当前引擎或文件端口未提供 Workflow 必需结构验证能力");
 expect(()=>assertWorkflowCapabilities([binding],{...actual,availableValidators:[]})).toThrowError("当前引擎或文件端口未提供 Workflow 必需结构验证能力");
 expect(()=>assertWorkflowCapabilities(Array.from({length:17},()=>binding),actual)).toThrowError("本任务的结构验证要求超过单轮记录上限");
});

it('显式隔离范围只接受范围能力，不回退原生工具',()=>{
 const contract=workflowContractSchema.parse({version:1,executionScope:{version:1,profile:'windows-lpac-node-v1',read:[{path:'result.txt',kind:'file'}],write:[]},delivery:{requiredToolEvidence:[{id:'read',toolName:'cbim_scoped_read'}]}});
 const native={availableTools:['read','write','cbim_scoped_read'],artifacts:true};
 expect(()=>assertWorkflowCapabilities([{contract}],native)).toThrowError("本机引擎没有实际范围执行能力");
 expect(()=>assertWorkflowCapabilities([{contract}],{...native,scopedTools:[]})).toThrowError("当前权限或引擎未提供 Workflow 必需工具：");
 expect(()=>assertWorkflowCapabilities([{contract}],{...native,scopedTools:['cbim_scoped_read']})).not.toThrow();
});
