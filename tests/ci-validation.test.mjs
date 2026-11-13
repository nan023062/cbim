import {afterEach, describe, expect, it, vi} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync, spawnSync} from 'node:child_process';
import {parse} from 'yaml';
import {classifyChanges, parseChangedPaths} from '../scripts/ci-scope.mjs';
import {assertCiResults} from '../scripts/ci-result.mjs';
import {balancedShards} from '../scripts/ci-test-shards';
import CiTestSequencer from '../scripts/ci-test-sequencer';
import {createHash} from 'node:crypto';
import {verifyShardCoverage} from '../scripts/ci-test-coverage.mjs';

const temporary = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const directory of temporary.splice(0)) {
    if (path.dirname(path.resolve(directory)) !== path.resolve(os.tmpdir()) || !path.basename(directory).startsWith('cbim-ci-')) throw Error('Invalid cleanup directory');
    fs.rmSync(directory,{recursive:true,force:true});
  }
});

describe('change routing', () => {
  it.each([
    [['README.md','design/development-log.md','design/verification/check.md'],'docs',false],
    [['website/index.html','website/release.json','README.md'],'website',true],
    [['src/a.ts','website/index.html'],'full',true],
    [['design/runtime/common-rules.md'],'full',false],
    [['design/business/module-spec.md'],'full',false],
    [['design/task/task-loop.md'],'full',false],
    [['branding/cbim.png'],'full',true],
    [['scripts/ci-website-smoke.mjs'],'full',true],
    [['.github/workflows/validate.yml'],'full',false],
    [['package.json','pnpm-lock.yaml'],'full',false],
    [['unknown.md'],'full',false],
    [[], 'full',false],
    [['website/../src/a.ts'],'full',false],
  ])('routes %j without a broad Markdown exemption', (files,mode,website) => {
    expect(classifyChanges(files)).toEqual({mode,website});
  });
  it('includes both rename/copy paths and keeps spaces without shell parsing', () => {
    const paths = parseChangedPaths('R100\0src/a.ts\0design/verification/a.md\0C090\0website/index.html\0website/copy page.html\0D\0README.md\0');
    expect(paths).toEqual(['README.md','design/verification/a.md','src/a.ts','website/copy page.html','website/index.html']);
    expect(classifyChanges(paths).mode).toBe('full');
    expect(parseChangedPaths('')).toEqual([]);
  });
  it.each(['M\0README.md','R100\0README.md\0','?\0README.md\0'])('fails closed on malformed diff %j', raw => {
    expect(()=>parseChangedPaths(raw)).toThrow();
  });
});

describe('balanced full test coverage', () => {
  it('balances long files, preserves every test once, and ignores input ordering', () => {
    const files = Array.from({length:24},(_,n)=>({id:`test-${n}`,duration:n<4?100:1}));
    const plan = balancedShards(files,4,f=>f.id,f=>f.duration);
    expect(plan.map(bin=>bin.reduce((n,f)=>n+f.duration,0))).toEqual([105,105,105,105]);
    expect(plan.flat()).toHaveLength(files.length);
    expect(new Set(plan.flat().map(f=>f.id)).size).toBe(files.length);
    expect(balancedShards([...files].reverse(),4,f=>f.id,f=>f.duration)).toEqual(plan);
  });
  it('rejects duplicate identities and invalid counts/weights instead of silently dropping tests', () => {
    expect(()=>balancedShards(['a','a'],4,x=>x,()=>1)).toThrow(/Duplicate/);
    expect(()=>balancedShards(['a'],0,x=>x,()=>1)).toThrow(/count/);
    expect(()=>balancedShards(['a'],4,x=>x,()=>NaN)).toThrow(/duration/);
  });
  it('uses the actual Vitest discovered set, including new tests absent from history', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(),'cbim-ci-'));temporary.push(root);
    const files = ['tests/controlled-file-pi.test.ts','tests/new-test.test.ts','tests/new-test.test.mjs','tests/test with spaces.test.ts'].map(name=>({moduleId:path.join(root,name),project:{name:''}}));
    vi.stubEnv('CI','true');
    const plans = [];
    for(let index=1;index<=4;index++) plans.push(await new CiTestSequencer({config:{root,shard:{index,count:4}}}).shard(files));
    expect(new Set(plans.flat())).toEqual(new Set(files));
    expect(plans.flat()).toHaveLength(files.length);
    const reports = [1,2,3,4].map(index=>JSON.parse(fs.readFileSync(path.join(root,`test-results/ci-shard-plan-${index}.json`),'utf8')));
    expect(new Set(reports.map(r=>r.discoveredDigest)).size).toBe(1);
    expect(new Set(reports.flatMap(r=>r.files))).toEqual(new Set(reports[0].allFiles));
    expect(reports.every(r=>r.discovered===files.length)).toBe(true);
    expect(await new CiTestSequencer({config:{root}}).shard(files)).toBe(files);
  });
});

describe('CI result cannot turn a skipped or failed check green', () => {
  const full = {scope:{result:'success'},static:{result:'success'},windows:{result:'success'},light:{result:'skipped'}};
  const light = {scope:{result:'success'},static:{result:'skipped'},windows:{result:'skipped'},light:{result:'success'}};
  it.each(['full','diagnostic'])('accepts complete %s checks', mode=>expect(()=>assertCiResults(mode,full)).not.toThrow());
  it.each(['docs','website'])('accepts intentional product skips only for %s', mode=>expect(()=>assertCiResults(mode,light)).not.toThrow());
  it.each(['failure','cancelled','skipped',undefined])('rejects product result %s', result=>expect(()=>assertCiResults('full',{...full,windows:{result}})).toThrow());
  it('rejects unknown routing and a failed scope or lightweight job', () => {
    expect(()=>assertCiResults(undefined,full)).toThrow();
    expect(()=>assertCiResults('full',{...full,scope:{result:'failure'}})).toThrow();
    expect(()=>assertCiResults('website',{...light,light:{result:'failure'}})).toThrow();
    expect(()=>assertCiResults('full',light)).toThrow();
  });
});

it('runs actual change detection and lightweight local-link checks on an isolated git repository', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'cbim-ci-'));temporary.push(root);
  const git = args=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  git(['init']);
  fs.writeFileSync(path.join(root,'README.md'),'# Before\n');fs.writeFileSync(path.join(root,'existing.md'),'target\n');
  git(['add','.']);git(['-c','user.name=CI test','-c','user.email=ci@example.invalid','commit','-m','base']);const base=git(['rev-parse','HEAD']);
  fs.writeFileSync(path.join(root,'README.md'),'# After\n\n[existing](existing.md)\n');
  git(['add','.']);git(['-c','user.name=CI test','-c','user.email=ci@example.invalid','commit','-m','docs']);const head=git(['rev-parse','HEAD']);
  const event=path.join(root,'event.json'),output=path.join(root,'output'),summary=path.join(root,'summary');
  fs.writeFileSync(event,JSON.stringify({pull_request:{base:{sha:base},head:{sha:head}}}));
  const env={...process.env,GITHUB_EVENT_NAME:'pull_request',GITHUB_EVENT_PATH:event,GITHUB_OUTPUT:output,GITHUB_STEP_SUMMARY:summary,CBIM_CI_BASE:base,CBIM_CI_HEAD:head};
  const run = script=>spawnSync(process.execPath,[path.resolve('scripts',script)],{cwd:root,env,encoding:'utf8'});
  expect(run('ci-scope.mjs').status).toBe(0);
  expect(fs.readFileSync(output,'utf8')).toContain('mode=docs\n');
  expect(run('ci-light-check.mjs').status).toBe(0);
  fs.writeFileSync(path.join(root,'README.md'),'# After\n\n[missing](missing.md)\n');git(['add','.']);git(['-c','user.name=CI test','-c','user.email=ci@example.invalid','commit','-m','bad link']);env.CBIM_CI_HEAD=git(['rev-parse','HEAD']);
  expect(run('ci-light-check.mjs').status).not.toBe(0);
});

it('wires shared checks independently and keeps one unconditional aggregate result', () => {
  const workflow=parse(fs.readFileSync('.github/workflows/validate.yml','utf8'));
  expect(workflow.jobs.windows.needs).toBe('scope');
  expect(workflow.jobs.static.needs).toBe('scope');
  expect(workflow.jobs.windows.steps.some(step=>step.run?.includes('pnpm typecheck'))).toBe(false);
  expect(workflow.jobs.static.steps.filter(step=>step.run==='pnpm typecheck')).toHaveLength(1);
  expect(workflow.jobs.result.needs).toEqual(['scope','static','windows','light']);
  expect(workflow.jobs.result.if).toBe('always()');
  expect(workflow.jobs.windows.strategy['fail-fast']).toBe(false);
  expect(workflow.jobs.windows.steps.find(step=>step.name==='Run full test suite').run).toContain('--shard=${{ matrix.shard }}/4');
});

describe('full CI artifact coverage', () => {
  function reports() {
    const allFiles=[1,2,3,4].map(n=>`:tests/${n}.test.ts`);
    const discoveredDigest=createHash('sha256').update(JSON.stringify(allFiles)).digest('hex');
    return allFiles.map((name,index)=>({plan:{index:index+1,count:4,allFiles,discovered:4,discoveredDigest,files:[name]},result:{success:true,numFailedTests:0,numPassedTests:1,numPendingTests:0,testResults:[{name:'D:/repo/'+name.slice(1)}]}}));
  }
  it('checks actual execution against discovered files across runners',()=>expect(verifyShardCoverage(reports())).toMatchObject({files:4,passed:4,failed:0,skipped:0}));
  it('rejects missing or duplicate shard artifacts',()=>{
    expect(()=>verifyShardCoverage(reports().slice(1))).toThrow();
    const values=reports();values[3]=values[0];expect(()=>verifyShardCoverage(values)).toThrow();
  });
  it('rejects silent no-execution, omissions, duplicate assignment and different discovery',()=>{
    const empty=reports();empty[0].result.testResults=[];expect(()=>verifyShardCoverage(empty)).toThrow();
    const omission=reports();omission[0].result.testResults=[];omission[0].plan.files=[];expect(()=>verifyShardCoverage(omission)).toThrow();
    const duplicate=reports();duplicate[3].plan.files=duplicate[0].plan.files;duplicate[3].result.testResults=duplicate[0].result.testResults;expect(()=>verifyShardCoverage(duplicate)).toThrow();
    const different=reports();different[1].plan.discoveredDigest='wrong';expect(()=>verifyShardCoverage(different)).toThrow();
  });
});
