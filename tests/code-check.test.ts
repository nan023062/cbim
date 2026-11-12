import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {afterEach,beforeEach,expect,it} from 'vitest';
import {CodeCheckRunner} from '../src/backend/main/platform/files/code-check-runner';
import {workflowContractSchema} from '../src/backend/core/workspace/workflow-contract';
import {codeCheckPassed,frozenCodeChecks,selectCodeCheck,codeRequirementsHash,type CodeCheckBinding} from '../src/backend/core/evidence/code-check';
import {preparedArtifactScopes} from '../src/backend/core/workspace/artifact-scope';
import {outputManifestHash} from '../src/backend/core/evidence/output-manifest-evidence';
import {artifactRuntimeFixture,artifactBinding,seedProgress,invoke} from './artifact-runtime-fixture';
import {runtimeToolGroup} from './runtime-tool-group';
import {validateWorkflowEvidence} from '../src/backend/core/evidence/workflow-evidence';
import {verifyOutputManifests} from '../src/backend/core/evidence/output-manifest-evidence';
import {completeOutputProof} from '../src/backend/core/evidence/complete-output-evidence';

let root:string;
beforeEach(async()=>{root=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-code-check-'));await fs.writeFile(path.join(root,'source.txt'),'original')});
afterEach(async()=>{await fs.rm(root,{recursive:true,force:true})});
function bindings(script:string,test=false):CodeCheckBinding[]{return [{moduleId:'module',workflowId:'workflow',workflowVersion:'1',contract:workflowContractSchema.parse({version:1,artifactScope:{version:1,roots:[{path:'source.txt',kind:'file'}]},delivery:{requireCompleteManifest:true,requiredCodeChecks:[{id:'check',purpose:'验证当前源码',program:'node',args:['-e',script],cwd:'.',timeoutMs:1000,success:test?{kind:'test-summary-json',minPassed:1}:{kind:'exit-code'}}]}})}]}
async function run(script:string,test=false){const values=bindings(script,test),checks=frozenCodeChecks(values);const execution=await new CodeCheckRunner(root,()=>{}).run(checks,preparedArtifactScopes(values),new AbortController().signal);return {values,checks,execution}}
it('真实命令成功才通过，非零退出拒绝',async()=>{const good=await run('process.exit(0)');expect(codeCheckPassed(good.checks,good.execution)).toBe(true);const bad=await run('process.exit(1)');expect(codeCheckPassed(bad.checks,bad.execution)).toBe(false);expect(bad.execution.commands[0].failure).toBe('exit')});
it.each(['','CBIM_TEST_SUMMARY {"passed":0,"failed":0,"skipped":3}','CBIM_TEST_SUMMARY {"passed":2,"failed":1,"skipped":0}'])('缺失、零用例或失败用例不通过：%s',async summary=>{const result=await run('console.log('+JSON.stringify(summary)+')',true);expect(codeCheckPassed(result.checks,result.execution)).toBe(false)});
it('实际非零通过用例的唯一摘要可以通过',async()=>{const result=await run('console.log(\'CBIM_TEST_SUMMARY {"passed":2,"failed":0,"skipped":0}\')',true);expect(codeCheckPassed(result.checks,result.execution)).toBe(true)});
it('检查中修改源码拒绝，超时不能冒充成功',async()=>{const changed=await run('require("fs").writeFileSync("source.txt","changed")');expect(changed.execution.sourceChanged).toBe(true);expect(codeCheckPassed(changed.checks,changed.execution)).toBe(false);const timeout=await run('setInterval(()=>{},100)');expect(timeout.execution.commands[0].failure).toBe('timeout')});
it('交付绑定检查时的源码指纹，旧检查不能引用新清单',async()=>{const {values,execution}=await run('process.exit(0)');const identity={workspaceId:'workspace',taskId:'task',runId:'run'},snapshotHash=outputManifestHash(execution.snapshot);const record={...execution,version:1 as const,identity,toolCallId:'check',knowledgeRevision:'knowledge',requirementsHash:codeRequirementsHash(values),snapshotHash,checkedAt:new Date().toISOString(),outcome:'passed' as const};const receipt={inputHash:'a'.repeat(64),recordedAt:new Date().toISOString(),version:1 as const,...identity,toolCallId:'check',toolName:'cbim_code_check_run',effects:['command' as const],scope:{kind:'unknown' as const,workspaceId:'workspace'},outcome:'succeeded' as const};expect(()=>selectCodeCheck(values,[receipt],identity,[record],{knowledgeRevision:'knowledge',manifestHash:'0'.repeat(64)} as never)).toThrow('源码集合');expect(selectCodeCheck(values,[receipt],identity,[record],{knowledgeRevision:'knowledge',manifestHash:snapshotHash} as never)?.snapshotHash).toBe(snapshotHash)});
it('缺少完整范围的声明不被接受',()=>{expect(workflowContractSchema.safeParse({version:1,delivery:{requiredCodeChecks:bindings('')[0].contract.delivery!.requiredCodeChecks}}).success).toBe(false)});
it('真实运行从授权检查到交付并由持久日志重算',async()=>{
  const values=bindings('process.exit(0)');values[0].moduleId='.cbim/workspace/module';values[0].contract.artifactScope!.roots=[{path:'File.txt',kind:'file'}];
  let directory='';
  const fixture=await artifactRuntimeFixture(async context=>{
    await seedProgress(context);
    expect((await context.beforeTool({name:'cbim_code_check_run',id:'code',input:{}})).allow).toBe(true);
    const result=await runtimeToolGroup(context,'code-check')!.call('cbim_code_check_run',{},'code');
    await context.emit({type:'tool.finished',data:{name:'cbim_code_check_run',id:'code',result,isError:false}});
    expect(JSON.parse(result.content[0].text).outcome).toBe('passed');
    const current=await invoke(context,'cbim_task_inspect','inspect',{});
    await invoke(context,'cbim_task_step','step',{expectedVersion:current.plan.version,id:'verify',state:'reported_done',evidenceIds:['code']});
    const updated=await invoke(context,'cbim_task_inspect','inspect2',{});
    const captured=await invoke(context,'cbim_task_manifest_capture','manifest',{expectedTaskProgressVersion:updated.plan.version});
    await invoke(context,'cbim_delivery_prepare','delivery',{expectedVersion:updated.plan.version,manifestId:captured.manifest.manifestId,summary:'检查通过',limitations:[]});
  },{workflowContracts:values,codeChecks:{run:(checks,scopes,signal)=>new CodeCheckRunner(directory,()=>{}).run(checks,scopes,signal)},describeTool:call=>({effects:call.name==='cbim_code_check_run'?['command']:call.name==='read'?['read']:['maintenance'],native:call.name==='read',contractVersion:1}),policy:async name=>({allow:true,effects:name==='cbim_code_check_run'?['command']:name==='read'?['read']:['maintenance'],scope:{kind:name==='cbim_code_check_run'?'unknown':'workspace',workspaceId:artifactBinding.workspaceId}})});
  directory=fixture.directory;
  try{const summary=await(await fixture.start()).done;expect(summary.status,JSON.stringify(summary.events.slice(-4))).toBe('completed');expect(summary.taskProgress?.delivery?.workflow?.codeCheck?.toolCallId).toBe('code');const manifest=verifyOutputManifests(summary.events,artifactBinding,'knowledge-one',preparedArtifactScopes(values)).records[0];expect(validateWorkflowEvidence(summary.events,fixture.task,values,[],completeOutputProof(manifest))).toEqual(summary.taskProgress!.delivery!.workflow)}finally{await fixture.cleanup()}
});
